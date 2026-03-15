from flask import Flask, request, jsonify, send_file, url_for
import yt_dlp
import os
import re
import requests
from io import BytesIO
from urllib.parse import quote

app = Flask(__name__)
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True

DOWNLOAD_FOLDER = 'downloads'
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

def get_ydl_opts(extra_opts=None):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'user_agent': USER_AGENT,
        'http_headers': {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        },
        'extractor_args': {
            'youtube': {
                'player_client': ['web', 'android'],
            }
        },
    }

    if os.path.exists('cookies.txt'):
        opts['cookiefile'] = 'cookies.txt'

    if extra_opts:
        opts.update(extra_opts)

    return opts


@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "error": "Not Found",
        "message": f"The requested URL {request.path} was not found on this server."
    }), 404


@app.route('/')
def index():
    return jsonify({
        "status": "API is running",
        "usage": {
            "info":     "/api/info?url=VIDEO_URL",
            "mp4":      "/api/download?url=VIDEO_URL&quality=720p&format=mp4",
            "mp3":      "/api/download?url=VIDEO_URL&format=mp3",
        },
        "note": "Place your YouTube cookies in cookies.txt to avoid bot detection.",
        "example": f"{request.url_root}api/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    })


@app.route('/api/info')
def get_info():
    video_url = request.args.get('url')
    if not video_url:
        return jsonify({"error": "URL parameter is missing"}), 400

    try:
        ydl_opts = get_ydl_opts()

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)

        available_formats = []
        resolutions = set()

        for f in info.get('formats', []):
            if f.get('height') and f.get('vcodec') != 'none':
                height = f.get('height')
                if height not in resolutions and height >= 144:
                    resolutions.add(height)
                    download_url = (
                        f"{request.url_root}api/download"
                        f"?url={quote(video_url, safe='')}"
                        f"&quality={height}p&format=mp4"
                    )
                    available_formats.append({
                        "quality": f"{height}p",
                        "format": "mp4",
                        "download_url": download_url
                    })

        available_formats.sort(
            key=lambda x: int(re.sub(r'\D', '', x['quality'])), reverse=True
        )

        mp3_url = (
            f"{request.url_root}api/download"
            f"?url={quote(video_url, safe='')}&format=mp3"
        )
        audio_format = {
            "quality": "best",
            "format": "mp3",
            "download_url": mp3_url
        }

        return jsonify({
            "title": info.get('title', 'No Title'),
            "duration": info.get('duration'),
            "thumbnail": url_for('proxy_thumbnail', video_id=info.get('id'), _external=True),
            "mp4_formats": available_formats,
            "mp3_format": audio_format
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/thumbnail/<video_id>')
def proxy_thumbnail(video_id):
    try:
        thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
        response = requests.get(thumbnail_url, headers={'User-Agent': USER_AGENT})
        if response.status_code != 200 or "image/gif" in response.headers.get('Content-Type', ''):
            thumbnail_url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
            response = requests.get(thumbnail_url, headers={'User-Agent': USER_AGENT})
            response.raise_for_status()

        return send_file(
            BytesIO(response.content),
            mimetype=response.headers.get('Content-Type', 'image/jpeg')
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/download')
def download_video():
    video_url = request.args.get('url')
    quality   = request.args.get('quality', '720p')
    fmt       = request.args.get('format', 'mp4').lower()

    if not video_url:
        return jsonify({"error": "Missing url parameter"}), 400

    if fmt not in ('mp4', 'mp3'):
        return jsonify({"error": "format must be 'mp4' or 'mp3'"}), 400

    try:
        output_template = os.path.join(DOWNLOAD_FOLDER, '%(title)s.%(ext)s')

        if fmt == 'mp3':
            extra_opts = {
                'format': 'bestaudio/best',
                'outtmpl': output_template,
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            }
        else:
            quality_num = re.sub(r'\D', '', quality)
            format_string = (
                f'bestvideo[height<={quality_num}][ext=mp4]'
                f'+bestaudio[ext=m4a]'
                f'/bestvideo[height<={quality_num}]+bestaudio'
                f'/best[height<={quality_num}]/best'
            )
            extra_opts = {
                'format': format_string,
                'outtmpl': output_template,
                'merge_output_format': 'mp4',
            }

        ydl_opts = get_ydl_opts(extra_opts)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            downloaded_file_path = ydl.prepare_filename(info)

        if fmt == 'mp3':
            mp3_path = os.path.splitext(downloaded_file_path)[0] + '.mp3'
            if os.path.exists(mp3_path):
                downloaded_file_path = mp3_path

        if not downloaded_file_path or not os.path.exists(downloaded_file_path):
            return jsonify({"error": "Downloaded file not found on disk"}), 500

        mimetype = 'audio/mpeg' if fmt == 'mp3' else 'video/mp4'

        return send_file(
            downloaded_file_path,
            as_attachment=True,
            download_name=os.path.basename(downloaded_file_path),
            mimetype=mimetype
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print("=" * 50)
    print("IMPORTANT: Place your YouTube cookies in 'cookies.txt'")
    print("to avoid bot detection and 403 errors!")
    print("=" * 50)
    app.run(debug=True, host='0.0.0.0', port=8080)