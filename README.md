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
2.  Create a `docker-compose.yml` file (provided above) in the same directory as your other files.
3.  Run the application from your terminal:
    ```bash
    docker-compose up --build
    ```
The API will be available at `http://localhost:8080`. Downloaded videos will appear in a `downloads` folder in your project directory.

### Running for Local Development (Without Docker)

1.  Install Python 3.8+ and ffmpeg on your system.
2.  Install the required Python packages:
    ```bash
    pip install -r requirements.txt
    ```
3.  Run the application with Gunicorn:
    ```bash
    gunicorn --workers 2 --timeout 120 --bind 0.0.0.0:8080 "header:app"
    ```

## Endpoints

### `/`

*   **Method:** GET
*   **Description:** Checks if the API is running.

### `/api/info`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) - The full YouTube video URL.
    *   `cookies` (optional) - Your YouTube browser cookies in Netscape format to bypass bot detection.
*   **Description:** Returns video title, thumbnail, and a list of available formats with download links.
*   **Success Response Example:**
    ```json
    {
      "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      "thumbnail": "http://127.0.0.1:8080/api/thumbnail/dQw4w9WgXcQ",
      "formats": [
        {
          "quality": "1080p",
          "download_url": "http://127.0.0.1:8080/api/download?quality=1080p&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
          "format_id": "137"
        },
        {
          "quality": "720p",
          "download_url": "http://127.0.0.1:8080/api/download?quality=720p&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
          "format_id": "136"
        }
      ]
    }
    ```

### `/api/download`

*   **Method:** GET
*   **Query Parameters:**
    *   `url` (required) - The YouTube video URL.
    *   `quality` (required) - Desired video quality (e.g., `1080p`, `720p`).
    *   `cookies` (optional) - Your YouTube browser cookies in Netscape format.
*   **Description:** Downloads the video in the requested resolution. The final file will be an MP4 with both video and audio merged.
*   **Response:** Returns the video file as an attachment.

### `/api/thumbnail/<video_id>`

*   **Method:** GET
*   **Description:** A proxy for the video's thumbnail image. This is used internally by the `/api/info` endpoint.


## Bypassing Bot Detection (429 Error)

If you use the API frequently, YouTube may temporarily block your server's IP address, resulting in a `429` error. To solve this, you can provide your browser's YouTube cookies.

#### Error Response Example:
```json
{
    "error": "YouTube rate limit or bot detection",
    "message": "YouTube is blocking requests from this server. To bypass this, you can provide your YouTube cookies.",
    "instructions": "1. In your browser, install an extension to export your YouTube cookies in Netscape format (e.g., 'Get cookies.txt LOCALLY'). 2. Copy the entire contents of the exported text file. 3. Add the copied text as a 'cookies' query parameter to the API URL.",
    "example": "http://127.0.0.1:8080/api/info?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&cookies=<PASTE_YOUR_COOKIE_DATA_HERE>",
    "privacy_notice": "Your cookies are used only for this single request to bypass the block and are not stored on the server."
}
```

### How to Get Your Cookies

1.  Install a browser extension that can export cookies in the **Netscape HTTP Cookie File** format. A good choice is **Get cookies.txt LOCALLY** for [Chrome](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/).
2.  Navigate to `youtube.com`.
3.  Click the extension's icon and export the cookies.
4.  Copy the entire text content from the downloaded `.txt` file.
5.  You can paste this text directly into the `cookies` parameter. URL encoding is often handled by browsers/clients, but if you run into issues, try URL-encoding the text first.

**Privacy Note:** The provided cookies are written to a temporary file that is used for this single request and is **immediately deleted** after the request is complete. They are never stored permanently on the server.