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

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def get_ydl_opts(extra_opts=None):
    """Generate yt-dlp options with proper headers and authentication"""
    opts = {
        'quiet': True,
        'no_warnings': True,
        'user_agent': USER_AGENT,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'web'],
                'player_skip': ['webpage'],
                'skip': ['hls', 'dash']
            }
        },
        'http_headers': {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Sec-Fetch-Mode': 'navigate',
        },
        'format_sort': ['res', 'ext:mp4:m4a'],
        'geo_bypass': True,
        'age_limit': None,
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
        "usage": "To get video information and download links, use the /api/info endpoint.",
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
                        "download_url": download_url,
                        "format_id": f.get('format_id')
                    })
        
        if not available_formats:
            common_resolutions = [2160, 1440, 1080, 720, 480, 360]
            for height in common_resolutions:
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
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if '429' in error_msg or 'bot' in error_msg.lower():
            return jsonify({
                "error": "YouTube rate limit or bot detection",
                "message": "Please add authentication cookies to bypass YouTube's bot detection. See README for instructions."
            }), 429
        return jsonify({"error": error_msg}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/thumbnail/<video_id>')
def proxy_thumbnail(video_id):
    try:
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        ydl_opts = get_ydl_opts({'skip_download': True})
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
        
        thumbnail_url = info.get('thumbnail')
        if not thumbnail_url:
            return jsonify({"error": "Thumbnail not found"}), 404

        response = requests.get(thumbnail_url, headers={'User-Agent': USER_AGENT})
        response.raise_for_status()

        return send_file(
            BytesIO(response.content),
            mimetype=response.headers.get('Content-Type', 'image/jpeg')
        )
    except yt_dlp.utils.DownloadError:
        return jsonify({"error": "Invalid video ID or access denied"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/download')
def download_video():
    video_url = request.args.get('url')
    quality = request.args.get('quality')

    if not video_url or not quality:
        return jsonify({"error": "Missing url or quality parameter"}), 400

    try:
        quality_num = re.sub(r'\D', '', quality)
        output_template = os.path.join(DOWNLOAD_FOLDER, '%(title)s - %(height)sp.%(ext)s')
        
        extra_opts = {
            'format': f'bestvideo[height<={quality_num}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': output_template,
            'merge_output_format': 'mp4',
        }
        
        ydl_opts = get_ydl_opts(extra_opts)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            filename = ydl.prepare_filename(info)
        
        if not os.path.exists(filename):
            return jsonify({"error": "Failed to download or locate the file"}), 500

        return send_file(filename, as_attachment=True, download_name=os.path.basename(filename))

    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        if '429' in error_msg or 'bot' in error_msg.lower():
            return jsonify({
                "error": "YouTube rate limit or bot detection",
                "message": "Authentication cookies required"
            }), 429
        return jsonify({"error": error_msg}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)