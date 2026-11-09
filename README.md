# Musiko MP3 for Vercel

The page is served from `public/`. One Node.js Function under `api/` looks up track details and streams the tagged MP3. The build installs verified Linux releases of yt-dlp and FFmpeg into the function bundle. The conversion uses a temporary directory and doesn't need a database or storage account.

## Update the existing Vercel project

1. Extract this ZIP into the root directory Vercel builds from your Musiko MP3 GitHub repo. Keep `api`, `public`, `scripts`, `package.json`, and `vercel.json` together at that root. Remove the previous `server.mjs` and `Start Musiko MP3.cmd` from that deploy directory. Remove any old routes that send `/` to a server function.
2. In Vercel's project settings, use the **Other** framework preset and Node.js **24.x**. Clear custom build and output overrides so `vercel.json` can set them. Leave **Fluid Compute** enabled so the function can use the configured 180-second timeout.
3. Push the replacement files to the branch connected to Vercel. After it finishes building, open the Vercel URL, paste a public YouTube link, and test **Prepare track** and **Download MP3**.

If the page loads but YouTube rejects the converter, check the Vercel runtime logs for `/api/track`. YouTube can reject requests from hosting providers. The Windows version can run on your own connection in that case.

YouTube video length is limited to 20 minutes. The source audio size limit is 60 MB and custom covers can be up to 2 MB. Use videos you own or have permission to download.
