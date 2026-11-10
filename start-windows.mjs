import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const tools = join(root, '.musiko-tools');
const ytDlp = join(tools, 'yt-dlp.exe');
const ffmpeg = join(tools, 'ffmpeg.exe');
const ffprobe = join(tools, 'ffprobe.exe');
const workDir = join(tools, 'work');

async function exists(path) {
  return stat(path).then(file => file.isFile() && file.size > 0, () => false);
}

async function download(url, destination, checksum) {
  const response = await fetch(url, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  if (hash.digest('hex') !== checksum) throw new Error('Tool checksum did not match the published release.');
}

async function installTools() {
  const needsYtDlp = !(await exists(ytDlp));
  const needsFfmpeg = !(await exists(ffmpeg)) || !(await exists(ffprobe));
  if (!needsYtDlp && !needsFfmpeg) return;
  console.log('Downloading the conversion tools for this folder. This only happens on the first run.');
  const scratch = await mkdtemp(join(tools, 'setup-'));
  try {
    if (needsYtDlp) {
      const file = join(scratch, 'yt-dlp.exe');
      await download('https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe', file,
        'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d');
      await rename(file, ytDlp);
    }
    if (needsFfmpeg) {
      const file = join(scratch, 'ffmpeg.zip');
      const release = 'ffmpeg-9.0.2-essentials_build';
      await download(`https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/${release}.zip`, file,
        '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba');
      execFileSync('tar.exe', ['-xf', file, '-C', scratch, '--strip-components=2',
        `${release}/bin/ffmpeg.exe`, `${release}/bin/ffprobe.exe`], { stdio: 'inherit', windowsHide: true });
      await rename(join(scratch, 'ffmpeg.exe'), ffmpeg);
      await rename(join(scratch, 'ffprobe.exe'), ffprobe);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This launcher needs 64-bit Windows and x64 Node.js.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or later.');
  await mkdir(workDir, { recursive: true });
  await installTools();
  process.env.YT_DLP = ytDlp;
  process.env.FFMPEG = ffmpeg;
  process.env.MUSIKO_WORK_DIR = workDir;
  process.env.MUSIKO_OPEN_BROWSER ??= '1';
  await import('./server.mjs');
} catch (error) {
  console.error(`Musiko MP3 could not start: ${error.message}`);
  process.exitCode = 1;
}
