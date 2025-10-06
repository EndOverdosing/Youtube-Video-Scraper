from flask import Flask, request, jsonify, send_file, url_for
import yt_dlp
import os
import re

app = Flask(__name__)
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = True

DOWNLOAD_FOLDER = 'downloads'
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

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

    ydl_opts = {'quiet': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)

        available_formats = []
        resolutions = set()
        for f in info.get('formats', []):
            if f.get('vcodec') != 'none' and f.get('acodec') == 'none' and f.get('ext') == 'mp4' and f.get('height'):
                height = f.get('height')
                if height not in resolutions:
                    resolutions.add(height)
                    download_url = url_for('download_video', url=video_url, quality=f"{height}p", _external=True)
                    available_formats.append({
                        "quality": f"{height}p",
                        "download_url": download_url
                    })
        
        available_formats.sort(key=lambda x: int(re.sub(r'\D', '', x['quality'])), reverse=True)

        return jsonify({
            "title": info.get('title', 'No Title'),
            "thumbnail": info.get('thumbnail', ''),
            "formats": available_formats
        })
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
        
        ydl_opts = {
            'format': f'bestvideo[height<={quality_num}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': output_template,
            'merge_output_format': 'mp4',
            'quiet': True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            filename = ydl.prepare_filename(info)
        
        if not os.path.exists(filename):
            return jsonify({"error": "Failed to download or locate the file"}), 500

        return send_file(filename, as_attachment=True, download_name=os.path.basename(filename))

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)