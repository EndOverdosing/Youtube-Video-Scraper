from flask import Flask, request, jsonify, send_file, url_for
import yt_dlp
import os
import re
import requests
from io import BytesIO
import uuid
from urllib.parse import urlencode, urlparse, parse_qs, urlunparse

app = Flask(__name__)
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True

DOWNLOAD_FOLDER = 'downloads'
TEMP_FOLDER = 'temp_cookies'
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
os.makedirs(TEMP_FOLDER, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def create_temp_cookie_file(cookie_string):
    if not cookie_string:
        return None
    filename = os.path.join(TEMP_FOLDER, f"cookies_{uuid.uuid4()}.txt")
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(cookie_string)
    return filename

def get_ydl_opts(extra_opts=None, cookie_file=None):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'user_agent': USER_AGENT,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'web'],
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
    }
    
    if cookie_file:
        opts['cookiefile'] = cookie_file
    elif os.path.exists('cookies.txt'):
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

def get_bot_detection_error_response():
    parsed_url = urlparse(request.url)
    query_params = parse_qs(parsed_url.query)
    
    query_params['cookies'] = ['<PASTE_YOUR_ENCODED_COOKIE_DATA_HERE>']
    
    new_query_string = urlencode(query_params, doseq=True)
    example_url = urlunparse(
        (parsed_url.scheme, parsed_url.netloc, parsed_url.path, 
         parsed_url.params, new_query_string, parsed_url.fragment)
    )

    return jsonify({
        "error": "YouTube rate limit, bot detection, or age restriction",
        "message": "YouTube is blocking requests from this server. This can happen due to rate-limiting or if the video is age-restricted. To bypass this, you must provide your YouTube browser cookies.",
        "instructions": "1. In your browser (while logged into YouTube), install an extension to export your cookies in Netscape format (e.g., 'Get cookies.txt LOCALLY'). 2. Copy the entire contents of the exported text file. 3. URL-encode the text (e.g., using urlencoder.org). 4. Add the encoded text as a 'cookies' query parameter to the API URL.",
        "example": example_url,
        "privacy_notice": "Your cookies are used only for this single request to bypass the block and are not stored on the server."
    }), 429

@app.route('/api/info')
def get_info():
    video_url = request.args.get('url')
    cookie_string = request.args.get('cookies')

    if not video_url:
        return jsonify({"error": "URL parameter is missing"}), 400

    temp_cookie_file = None
    try:
        temp_cookie_file = create_temp_cookie_file(cookie_string)
        ydl_opts = get_ydl_opts(cookie_file=temp_cookie_file)
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)

        available_formats = []
        resolutions = set()
        
        for f in info.get('formats', []):
            if f.get('height') and f.get('vcodec') != 'none':
                height = f.get('height')
                if height not in resolutions and height >= 144:
                    resolutions.add(height)
                    download_params = {'url': video_url, 'quality': f"{height}p"}
                    if cookie_string:
                        download_params['cookies'] = cookie_string
                    
                    download_url = url_for('download_video', **download_params, _external=True)
                    available_formats.append({
                        "quality": f"{height}p",
                        "download_url": download_url,
                        "format_id": f.get('format_id')
                    })
        
        available_formats.sort(key=lambda x: int(re.sub(r'\D', '', x['quality'])), reverse=True)

        return jsonify({
            "title": info.get('title', 'No Title'),
            "thumbnail": url_for('proxy_thumbnail', video_id=info.get('id'), _external=True),
            "formats": available_formats
        })
    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e).lower()
        block_patterns = ['429', 'bot', 'unavailable', 'sign in', 'age-restricted', 'confirm your age']
        if any(p in error_msg for p in block_patterns):
            return get_bot_detection_error_response()
        return jsonify({"error": "yt-dlp error", "message": str(e)}), 500
    except Exception as e:
        return jsonify({"error": "An unexpected error occurred", "message": str(e)}), 500
    finally:
        if temp_cookie_file and os.path.exists(temp_cookie_file):
            os.remove(temp_cookie_file)

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
    quality = request.args.get('quality')
    cookie_string = request.args.get('cookies')

    if not video_url or not quality:
        return jsonify({"error": "Missing url or quality parameter"}), 400

    temp_cookie_file = None
    downloaded_file_path = None
    try:
        quality_num = re.sub(r'\D', '', quality)
        output_template = os.path.join(DOWNLOAD_FOLDER, '%(title)s - %(height)sp - %(id)s.%(ext)s')
        
        extra_opts = {
            'format': f'bestvideo[height<={quality_num}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': output_template,
            'merge_output_format': 'mp4',
        }
        
        temp_cookie_file = create_temp_cookie_file(cookie_string)
        ydl_opts = get_ydl_opts(extra_opts, cookie_file=temp_cookie_file)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            downloaded_file_path = ydl.prepare_filename(info)
        
        if not downloaded_file_path or not os.path.exists(downloaded_file_path):
            return jsonify({"error": "Failed to download or locate the file"}), 500

        return send_file(downloaded_file_path, as_attachment=True, download_name=os.path.basename(downloaded_file_path))

    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e).lower()
        block_patterns = ['429', 'bot', 'unavailable', 'sign in', 'age-restricted', 'confirm your age']
        if any(p in error_msg for p in block_patterns):
            return get_bot_detection_error_response()
        return jsonify({"error": "yt-dlp error", "message": str(e)}), 500
    except Exception as e:
        return jsonify({"error": "An unexpected error occurred", "message": str(e)}), 500
    finally:
        if temp_cookie_file and os.path.exists(temp_cookie_file):
            os.remove(temp_cookie_file)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)