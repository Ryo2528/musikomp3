# Musiko MP3

A standalone website that converts a single public YouTube video to MP3. You can edit the title, artist, and album, and keep the video thumbnail, replace it with your own cover, or leave the artwork out. The exported file contains ID3 tags that players can read.

## Start on Windows

1. Extract the ZIP. The launcher needs [Node.js 22 or later](https://nodejs.org/en/download) for Windows x64.
2. Double-click **Start Musiko MP3.cmd**. On the first run it downloads and verifies yt-dlp and FFmpeg, then saves them in the extracted folder. The browser opens when the converter is ready.
3. Paste a link, select **Prepare track**, review the details, then select **Download MP3**. Leave the terminal open while using the site. If the browser doesn't open, visit <http://127.0.0.1:8787> manually.

On macOS or Linux, install the same prerequisites and run `node server.mjs` from the extracted folder. Use an official yt-dlp build with its solver included. `YT_DLP` and `FFMPEG` can point to absolute executable paths if needed. Keep `ffprobe` in the same directory as FFmpeg.

## Conversion and hosting

- Accepts individual YouTube, YouTube Music, Shorts, and `youtu.be` links. Videos must be public and no longer than 20 minutes. The converter needs an internet connection, and private, age-restricted, and unavailable videos may fail.
- The title uses the track name when YouTube provides it. The artist falls back to the uploader or channel. Album stays blank when it is unavailable. Edit these fields before downloading for accurate library tags.
- If YouTube changes how playback works, update yt-dlp and try again. YouTube may also reject requests from some IP addresses.
- The app binds to `127.0.0.1` and keeps a few recent preparations temporarily on the machine running it. For a public deployment, use a host that can run a persistent Node.js process with yt-dlp and FFmpeg, and add authentication and rate limits before exposing the converter. A static Vercel upload does not run this backend.
- Use videos you own or have permission to download.
