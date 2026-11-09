import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const origin = `http://${host}:${port}`;
const ytDlp = process.env.YT_DLP || 'yt-dlp';
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const coverLimit = 2 * 1024 * 1024;
const ttl = 20 * 60_000;
const jobs = new Map();
let preparing = false;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function youtubeUrl(value) {
  let url;
  try { url = new URL(value); } catch { }
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new RequestError(400, 'Paste a valid YouTube video link.');
  }
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1];
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new RequestError(400, 'Use a link to one YouTube video or song.');
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

async function readJson(request, limit) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'Expected a JSON request.');
  }
  const chunks = [];
  let size = 0;
  const body = request.iterator({ destroyOnReturn: false });
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { }
  throw new RequestError(400, 'The request could not be read.');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function tag(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180).toWellFormed() : '';
}

function parseToolError(error) {
  const detail = `${error.stderr || ''} ${error.stdout || ''}`;
  if (error.code === 'ENOENT') return 'Install yt-dlp and FFmpeg, then restart the app.';
  if (error.killed) return 'The conversion timed out. Try again or choose a shorter video.';
  if (/not pass filter|larger than max-filesize/i.test(detail)) return 'Choose a finished video up to 20 minutes long.';
  if (/sign in|confirm you.re not a bot|HTTP Error 429/i.test(detail)) return 'YouTube blocked this request. Try again later or update yt-dlp.';
  if (/private video|video (?:is )?unavailable|not available|members.only|age.restricted/i.test(detail)) return 'This video is unavailable. Try a public video that plays without signing in.';
  if (/resolve host|connection|network|timed out|getaddrinfo/i.test(detail)) return 'Could not connect to YouTube. Check your internet connection and try again.';
  if (/ffmpeg not found|ffprobe not found/i.test(detail)) return 'Install FFmpeg and FFprobe, then restart the app.';
  return 'Could not prepare this video. Try a different public link or update yt-dlp.';
}

async function removeJob(id, job) {
  jobs.delete(id);
  await rm(job.dir, { recursive: true, force: true }).catch(console.error);
}

const cleanup = setInterval(() => {
  for (const [id, job] of jobs) {
    if (!job.exporting && job.expires < Date.now()) void removeJob(id, job);
  }
}, 30_000);
cleanup.unref();

async function prepare(value) {
  const url = youtubeUrl(value);
  if (preparing) throw new RequestError(429, 'A track is already being prepared. Try again in a moment.');
  preparing = true;
  let dir;
  try {
    if (jobs.size >= 4) {
      const oldest = [...jobs].find(([, job]) => !job.exporting);
      if (!oldest) throw new RequestError(429, 'Wait for the current downloads to finish.');
      await removeJob(...oldest);
    }
    dir = await mkdtemp(join(tmpdir(), 'musiko-mp3-'));
    const args = [
      '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-cache-dir', '--no-progress',
      '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '15', '--retries', '2',
      '--break-match-filters', '!is_live & duration > 0 & duration <= 1200', '--max-filesize', '60M',
      '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '2',
      '--write-info-json', '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '-o', 'track.%(ext)s'
    ];
    if (isAbsolute(ffmpeg)) args.push('--ffmpeg-location', dirname(ffmpeg));
    const { stdout, stderr } = await exec(ytDlp, [...args, '--', url], { cwd: dir, windowsHide: true, timeout: 300_000 });
    if (/does not pass filter|larger than max-filesize/i.test(`${stdout} ${stderr}`)) {
      throw new RequestError(400, 'Choose a finished video up to 20 minutes long with a smaller audio file.');
    }
    const info = JSON.parse(await readFile(join(dir, 'track.info.json'), 'utf8'));
    const mp3 = await stat(join(dir, 'track.mp3'));
    if (!mp3.isFile() || mp3.size === 0) throw new Error('MP3 missing');
    const hasCover = await stat(join(dir, 'track.jpg')).then(file => file.isFile(), () => false);
    const id = randomUUID();
    jobs.set(id, { dir, hasCover, exporting: false, expires: Date.now() + ttl });
    dir = undefined;
    return {
      id,
      title: tag(info.track || info.title),
      artist: tag(info.artist || info.uploader || info.channel),
      album: tag(info.album),
      duration: Number(info.duration) || 0,
      cover: hasCover ? `/api/cover/${id}` : null
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    console.error(error.stderr || error.message);
    throw new RequestError(502, parseToolError(error));
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(console.error);
    preparing = false;
  }
}

async function selectCover(job, data) {
  if (!data.cover) return data.includeCover && job.hasCover ? 'track.jpg' : null;
  if (typeof data.cover !== 'string') throw new RequestError(400, 'Choose a JPG or PNG cover.');
  const bytes = Buffer.from(data.cover, 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (bytes.length > coverLimit || (!png && !jpeg)) {
    throw new RequestError(400, 'Choose a JPG or PNG cover under 2 MB.');
  }
  const input = png ? 'upload.png' : 'upload.jpg';
  await writeFile(join(job.dir, input), bytes);
  try {
    await exec(ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-f', 'image2', '-pattern_type', 'none',
      '-i', input, '-frames:v', '1', '-vf', 'scale=1200:1200:force_original_aspect_ratio=decrease',
      '-update', '1', 'custom.jpg'], { cwd: job.dir, windowsHide: true, timeout: 15_000 });
  } catch {
    throw new RequestError(400, 'This image could not be used. Try a different JPG or PNG.');
  } finally {
    await rm(join(job.dir, input), { force: true }).catch(console.error);
  }
  return 'custom.jpg';
}

async function exportMp3(response, data) {
  const job = jobs.get(data.id);
  if (!job || job.expires < Date.now()) throw new RequestError(404, 'This track has expired. Prepare the link again.');
  if (job.exporting) throw new RequestError(409, 'This track is already being exported.');
  const title = tag(data.title);
  if (!title) throw new RequestError(400, 'Enter a track title.');
  job.exporting = true;
  try {
    const cover = await selectCover(job, data);
    const args = ['-nostdin', '-loglevel', 'error', '-y', '-i', 'track.mp3'];
    if (cover) args.push('-i', cover);
    args.push('-map', '0:a:0', '-map_metadata', '-1', '-c:a', 'copy', '-id3v2_version', '3');
    if (cover) args.push('-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic',
      '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)');
    args.push('-metadata', `title=${title}`, '-metadata', `artist=${tag(data.artist)}`,
      '-metadata', `album=${tag(data.album)}`, 'export.mp3');
    await exec(ffmpeg, args, { cwd: job.dir, windowsHide: true, timeout: 30_000 });
    const file = join(job.dir, 'export.mp3');
    const filename = title.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '') || 'track';
    const encoded = encodeURIComponent(`${filename}.mp3`).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`);
    response.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': (await stat(file)).size,
      'Content-Disposition': `attachment; filename="track.mp3"; filename*=UTF-8''${encoded}`
    });
    await pipeline(createReadStream(file), response);
  } finally {
    await Promise.all(['export.mp3', 'custom.jpg'].map(name => rm(join(job.dir, name), { force: true }).catch(console.error)));
    job.expires = Date.now() + ttl;
    job.exporting = false;
  }
}

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']]
]);

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (request.headers.host !== `${host}:${port}`) throw new RequestError(403, 'Open the local Musiko MP3 address.');
    if (request.method === 'POST') {
      if (request.headers.origin !== origin) throw new RequestError(403, 'Open this app in your browser to convert a track.');
      if (request.url === '/api/prepare') {
        const body = await readJson(request, 4_096);
        return json(response, 200, await prepare(body.url));
      }
      if (request.url === '/api/export') return await exportMp3(response, await readJson(request, 3 * 1024 * 1024));
    }
    if (request.method === 'GET') {
      const asset = assets.get(request.url);
      if (asset) {
        const [name, type] = asset;
        const body = await readFile(join(root, 'public', name));
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return response.end(body);
      }
      const id = /^\/api\/cover\/([a-f0-9-]{36})$/.exec(request.url)?.[1];
      const job = jobs.get(id);
      if (job?.hasCover && job.expires > Date.now()) {
        const body = await readFile(join(job.dir, 'track.jpg'));
        response.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return response.end(body);
      }
    }
    throw new RequestError(404, 'Page not found.');
  } catch (error) {
    if (response.headersSent) return response.destroy();
    if (error instanceof RequestError) return json(response, error.status, { error: error.message });
    console.error(error.stderr || error.message);
    json(response, 500, { error: 'Could not finish this request. Check that yt-dlp and FFmpeg are installed and try again.' });
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `${origin} is already in use.` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`Musiko MP3 is ready at ${origin}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await Promise.all([...jobs].map(([id, job]) => removeJob(id, job)));
    });
  });
}
