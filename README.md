![Banner](https://applescoop.org/image/wallpapers/mac/vibrant-sunset-in-the-forest-mountains-landscapes-nature-8k-top-rated-most-downloaded-free-download-wallpapers-for-macbook-pro-and-macbook-air-and-microsoft-windows-desktop-pcs-4k-07-12-2024-1733638654-hd-wallpaper.webp)

# YouTube Video Info & Download API

A simple Flask API to fetch YouTube video information and provide downloadable links. It includes a mechanism to bypass YouTube's rate-limiting and bot detection using browser cookies.

## Features

*   Fetch video title, thumbnail, and available formats.
*   Provide direct download links for specific video qualities.
*   Bypass YouTube rate-limiting/bot detection using browser cookies.
*   Handles merging of video and audio streams automatically.
*   Ready to be deployed with Docker and Gunicorn.
*   Returns informative JSON responses, including helpful error messages.

## Requirements

*   Docker & Docker Compose (Recommended)
*   ffmpeg (Included in the Docker image)

## Running the API with Docker (Recommended)

This is the easiest and most reliable way to run the application.

1.  Make sure you have Docker and Docker Compose installed.
2.  Save the `docker-compose.yml` file in your project directory.
3.  Run the application from your terminal:
    ```bash
    docker-compose up --build
    ```
The API will be available at `http://localhost:8080`. Downloaded videos will appear in a `downloads` folder in your project directory.

## Endpoints

(All endpoints are relative to your base URL, e.g., `http://localhost:8080`)

### `/api/info`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) - The full YouTube video URL.
    *   `cookies` (optional) - Your **URL-encoded** YouTube browser cookies.
*   **Description:** Returns video title, thumbnail, and a list of available formats.

### `/api/download`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) - The YouTube video URL.
    *   `quality` (required) - Desired video quality (e.g., `1080p`, `720p`).
    *   `cookies` (optional) - Your **URL-encoded** YouTube browser cookies.
*   **Description:** Downloads the video in the requested resolution as a merged MP4 file.

---

## Bypassing Bot Detection (429 Error)

If you use the API frequently, YouTube may temporarily block your server, resulting in a `429` error. To solve this, you can provide your browser's cookies.

### How to Get and Use Your Cookies

1.  **Install a Cookie Exporter Extension:**
    *   Use a browser extension that can export cookies in the **Netscape HTTP Cookie File** format.
    *   Recommended: **Get cookies.txt LOCALLY** for [Chrome](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/).

2.  **Export Cookies for YouTube:**
    *   Navigate to `youtube.com`.
    *   Click the extension's icon and export/download the cookies file (`cookies.txt`).

3.  **Copy the Contents:**
    *   Open the downloaded `cookies.txt` file and copy the **entire text content**.

4.  **IMPORTANT: URL-Encode the Cookie Data:**
    *   Go to a site like [**urlencoder.org**](https://www.urlencoder.org/).
    *   Paste the copied cookie text into the box and click **Encode**.
    *   This converts special characters (like `#`, spaces, and newlines) into a format safe for URLs (e.g., `%23`, `%20`).

5.  **Use the Encoded String in the API:**
    *   Append the final, encoded string to your API request as the `cookies` parameter.

**Privacy Note:** The provided cookies are written to a temporary file that is used for this single request and is **immediately deleted** after the request is complete. They are never stored permanently on the server.