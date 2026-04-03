---
title: Youtube Video Scraper
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
---

![Banner](https://applescoop.org/image/wallpapers/mac/vibrant-sunset-in-the-forest-mountains-landscapes-nature-8k-top-rated-most-downloaded-free-download-wallpapers-for-macbook-pro-and-macbook-air-and-microsoft-windows-desktop-pcs-4k-07-12-2024-1733638654-hd-wallpaper.webp)

# YouTube Video Info & Download API

A Node.js/Express API to fetch YouTube video information and provide downloadable links. Bypasses bot detection using browser cookies and Puppeteer stealth.

## Features

- Fetch video title, thumbnail, duration, and available formats
- Download videos as **MP4** in any available resolution
- Download audio-only as **MP3** (192kbps) via FFmpeg
- Bypass YouTube bot detection using browser cookies
- Scrape pages with Puppeteer + stealth plugin
- Proxy YouTube thumbnails
- Ready to deploy with Docker on Hugging Face Spaces

## Requirements

- Docker (recommended)
- Node.js 20+ (for local runs)
- ffmpeg and yt-dlp (included in Docker image)

## Running with Docker

```bash
docker build -t yt-scraper .
docker run -p 7860:7860 yt-scraper
```

The API will be available at `http://localhost:7860`.

## Running Locally (Without Docker)

Requires Node.js 20+, ffmpeg, and yt-dlp installed and on your PATH.

```bash
npm install
node index.js
```

The API will be available at `http://localhost:8080`.

## Endpoints

### `GET /api/info?url=VIDEO_URL`
Returns title, channel, thumbnail, duration, view count, and all available MP4/MP3 download links.

### `GET /api/download?url=VIDEO_URL&format=mp4&quality=720p`
Downloads the video. `format` is `mp4` or `mp3`. `quality` is e.g. `1080p`, `720p`, `480p`.

### `GET /api/thumbnail/:videoId`
Proxies the YouTube thumbnail image.

### `GET /api/metadata/:videoId`
Returns oEmbed metadata for a video.

### `GET /api/comments/:videoId?limit=30`
Returns top comments for a video.

### `GET /api/related/:videoId`
Returns a suggested search query for related videos.

### `GET /api/scrape?url=PAGE_URL`
Scrapes a page using Puppeteer with Cloudflare bypass.

### `GET /api/scrape/text?url=PAGE_URL&selector=CSS_SELECTOR`
Extracts text from a page, optionally filtered by CSS selector.

## Bypassing Bot Detection (403 / 429 Errors)

1. Install the **Get cookies.txt LOCALLY** extension for [Chrome](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/)
2. Go to `youtube.com` while logged in and export cookies as `cookies.txt`
3. Place `cookies.txt` in the project root — it will be picked up automatically

> **Privacy Note:** Cookies are read locally and never transmitted anywhere other than YouTube's servers for authentication.