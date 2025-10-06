# YouTube Video Info & Download API

A simple Flask API to fetch YouTube video information and provide downloadable links for specific video qualities.


## Features

* Fetch video title, thumbnail, and available video-only formats.
* Download videos in selected resolutions (MP4 format).
* Handles merging of video and audio streams automatically.
* Returns JSON responses for easy integration.


## Requirements

* Python 3.8+
* Flask
* yt-dlp

Install dependencies:

```bash
pip install flask yt-dlp
```


## Running the API

```bash
python main.py
```

The API will run at `http://0.0.0.0:8080/`.


## Endpoints

### `/`

* **Method:** GET
* **Description:** Checks if the API is running.
* **Response Example:**

```json
{
  "status": "API is running",
  "usage": "To get video information and download links, use the /api/info endpoint.",
  "example": "http://localhost:8080/api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

### `/api/info`

* **Method:** GET
* **Query Parameters:**

  * `url` - YouTube video URL
* **Description:** Returns video title, thumbnail, and downloadable formats.
* **Response Example:**

```json
{
  "title": "Rick Astley - Never Gonna Give You Up",
  "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  "formats": [
    {
      "quality": "720p",
      "download_url": "http://localhost:8080/api/download?url=...&quality=720p"
    }
  ]
}
```

### `/api/download`

* **Method:** GET
* **Query Parameters:**

  * `url` - YouTube video URL
  * `quality` - Desired video quality (e.g., `720p`)
* **Description:** Downloads the video in the requested resolution as MP4.
* **Response:** Returns the video file as an attachment.


## Notes

* Downloads are stored temporarily in the `downloads` folder.
* Only video-only MP4 streams are listed for download.
* Merges video and audio if necessary.