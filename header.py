from flask import Flask, request, jsonify, send_file, url_for
import yt_dlp
import os
import re
import requests
from io import BytesIO

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
        "usage": "Use /api/info?url=VIDEO_URL to get video info",
        "note": "Place your YouTube cookies in cookies.txt file to avoid bot detection",
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
                    download_url = url_for('download_video', url=video_url, quality=f"{height}p", _external=True)
                    available_formats.append({
                        "quality": f"{height}p",
                        "download_url": download_url
                    })
        
        available_formats.sort(key=lambda x: int(re.sub(r'\D', '', x['quality'])), reverse=True)

        return jsonify({
            "title": info.get('title', 'No Title'),
            "thumbnail": url_for('proxy_thumbnail', video_id=info.get('id'), _external=True),
            "formats": available_formats
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
    quality = request.args.get('quality', '720p')

    if not video_url:
        return jsonify({"error": "Missing url parameter"}), 400

    try:
        quality_num = re.sub(r'\D', '', quality)
        output_template = os.path.join(DOWNLOAD_FOLDER, '%(title)s.%(ext)s')
        
        format_string = f'bestvideo[height<={quality_num}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={quality_num}]+bestaudio/best[height<={quality_num}]/best'
        
        extra_opts = {
            'format': format_string,
            'outtmpl': output_template,
            'merge_output_format': 'mp4',
        }
        
        ydl_opts = get_ydl_opts(extra_opts)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            downloaded_file_path = ydl.prepare_filename(info)
        
        if not downloaded_file_path or not os.path.exists(downloaded_file_path):
            return jsonify({"error": "Failed to download file"}), 500

        return send_file(downloaded_file_path, as_attachment=True, download_name=os.path.basename(downloaded_file_path))

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("="*50)
    print("IMPORTANT: Place your YouTube cookies in 'cookies.txt'")
    print("to avoid bot detection and 403 errors!")
    print("="*50)
    app.run(debug=True, host='0.0.0.0', port=8080)