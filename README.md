![Banner](https://applescoop.org/image/wallpapers/mac/vibrant-sunset-in-the-forest-mountains-landscapes-nature-8k-top-rated-most-downloaded-free-download-wallpapers-for-macbook-pro-and-macbook-air-and-microsoft-windows-desktop-pcs-4k-07-12-2024-1733638654-hd-wallpaper.webp)

# YouTube Video Info & Download API

A simple Flask API to fetch YouTube video information and provide downloadable links. It includes a mechanism to bypass YouTube's rate-limiting and bot detection using browser cookies.

## Features

*   Fetch video title, thumbnail, duration, and available formats.
*   Download videos as **MP4** in any available resolution.
*   Download audio-only as **MP3** (192kbps) via FFmpeg post-processing.
*   Bypass YouTube rate-limiting/bot detection using browser cookies.
*   Handles merging of video and audio streams automatically.
*   Ready to be deployed with Docker and Gunicorn.
*   Returns informative JSON responses, including helpful error messages.

## Requirements

*   Docker & Docker Compose (Recommended)
*   ffmpeg (Included in the Docker image — required for MP3 conversion and stream merging)

## Running the API with Docker (Recommended)

This is the easiest and most reliable way to run the application.

1.  Make sure you have Docker and Docker Compose installed.
2.  Save the `docker-compose.yml` file in your project directory.
3.  Run the application from your terminal:
    ```bash
    docker-compose up --build
    ```
The API will be available at `http://localhost:8080`. Downloaded files will appear in a `downloads` folder in your project directory.

## Endpoints

(All endpoints are relative to your base URL, e.g., `http://localhost:8080`)

### `/api/info`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) — The full YouTube video URL.
*   **Description:** Returns the video title, duration (seconds), thumbnail, a list of available MP4 resolutions (`mp4_formats`), and a pre-built MP3 download link (`mp3_format`).

**Example response:**
```json
{
  "title": "My Video",
  "duration": 213,
  "thumbnail": "http://localhost:8080/api/thumbnail/VIDEO_ID",
  "mp4_formats": [
    { "quality": "1080p", "format": "mp4", "download_url": "http://localhost:8080/api/download?url=...&quality=1080p&format=mp4" },
    { "quality": "720p",  "format": "mp4", "download_url": "http://localhost:8080/api/download?url=...&quality=720p&format=mp4" }
  ],
  "mp3_format": {
    "quality": "best", "format": "mp3", "download_url": "http://localhost:8080/api/download?url=...&format=mp3"
  }
}
```

---

### `/api/download`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) — The YouTube video URL.
    *   `format` (required) — `mp4` for video or `mp3` for audio-only.
    *   `quality` (required for MP4) — Desired resolution, e.g. `1080p`, `720p`, `480p`. Ignored for MP3.
*   **Description:**
    *   **MP4** — Downloads the video merged with audio at the requested resolution.
    *   **MP3** — Extracts and converts the best available audio stream to a 192kbps MP3 file.

**Example URLs:**
```
# Download 1080p MP4
GET /api/download?url=https://www.youtube.com/watch?v=VIDEOID&quality=1080p&format=mp4

# Download MP3 (audio only)
GET /api/download?url=https://www.youtube.com/watch?v=VIDEOID&format=mp3
```

---

## Bypassing Bot Detection (403 / 429 Errors)

If you receive `403 Forbidden` or `429 Too Many Requests` errors, YouTube is blocking the server. Providing your browser's cookies resolves this.

### How to Get and Use Your Cookies

1.  **Install a Cookie Exporter Extension:**
    *   Use a browser extension that exports cookies in the **Netscape HTTP Cookie File** format.
    *   Recommended: **Get cookies.txt LOCALLY** for [Chrome](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/).

2.  **Export Cookies for YouTube:**
    *   Navigate to `youtube.com` while logged in.
    *   Click the extension icon and export the cookies as `cookies.txt`.

3.  **Place the file in your project directory:**
    *   Save `cookies.txt` in the same folder as `header.py`.
    *   The API will detect and use it automatically — no configuration needed.

> **Privacy Note:** Cookies are read locally and are never transmitted or stored anywhere other than your own machine.

---

## Running Locally (Without Docker)

Requires Python 3.10+ and **ffmpeg** installed and on your PATH.

```bash
# Install ffmpeg (Windows)
winget install ffmpeg

# Install Python dependencies
pip install -r requirements.txt

# Start the server
python header.py
```

The API will be available at `http://localhost:8080`.