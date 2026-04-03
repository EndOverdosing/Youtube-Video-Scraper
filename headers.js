const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

const DOWNLOAD_FOLDER = path.resolve('downloads');
if (!fs.existsSync(DOWNLOAD_FOLDER)) fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-us,en;q=0.5',
    'Sec-Fetch-Mode': 'navigate',
};

function toSlash(p) {
    return p.replace(/\\/g, '/');
}

function ytdlp(args) {
    return new Promise((resolve, reject) => {
        execFile('yt-dlp', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                const msg = (stderr || '').trim() || (stdout || '').trim() || err.message;
                reject(new Error(msg));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

function baseYtdlpArgs() {
    const args = ['--no-playlist'];
    if (fs.existsSync('cookies.txt')) args.push('--cookies', toSlash(path.resolve('cookies.txt')));
    return args;
}

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, ...options });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
}

async function fetchBuffer(url) {
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buffer: await res.buffer(), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

async function withCloudflare(url) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent(UA);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);
        const html = await page.content();
        const cookies = await page.cookies();
        return { html, cookies };
    } finally {
        await browser.close();
    }
}

function formatCount(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function videoIdFromUrl(url) {
    try {
        if (url.includes('youtu.be/')) {
            return new URL(url).pathname.split('/').filter(Boolean)[0] || null;
        }
        const u = new URL(url);
        if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    } catch { }
    return null;
}

app.get('/', (req, res) => {
    res.json({
        status: 'API is running',
        usage: {
            info: '/api/info?url=VIDEO_URL',
            mp4: '/api/download?url=VIDEO_URL&quality=720p&format=mp4',
            mp3: '/api/download?url=VIDEO_URL&format=mp3',
            comments: '/api/comments/VIDEO_ID',
            related: '/api/related/VIDEO_ID',
            metadata: '/api/metadata/VIDEO_ID',
            scrape: '/api/scrape?url=PAGE_URL',
            thumbnail: '/api/thumbnail/VIDEO_ID',
        },
        note: 'Place YouTube cookies in cookies.txt to avoid bot detection.',
    });
});

app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    try {
        const args = [...baseYtdlpArgs(), '--dump-json', url];
        const raw = await ytdlp(args);
        const info = JSON.parse(raw);

        const seen = new Set();
        const mp4Formats = [];

        for (const f of (info.formats || [])) {
            if (f.height && f.vcodec !== 'none' && f.height >= 144 && !seen.has(f.height)) {
                seen.add(f.height);
                mp4Formats.push({
                    quality: `${f.height}p`,
                    format: 'mp4',
                    download_url: `${req.protocol}://${req.get('host')}/api/download?url=${encodeURIComponent(url)}&quality=${f.height}p&format=mp4`,
                });
            }
        }

        mp4Formats.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

        res.json({
            id: info.id,
            title: info.title || 'No Title',
            channel: info.uploader || info.channel || '',
            description: info.description || '',
            duration: info.duration,
            view_count: info.view_count,
            like_count: info.like_count,
            upload_date: info.upload_date,
            thumbnail: `${req.protocol}://${req.get('host')}/api/thumbnail/${info.id}`,
            mp4_formats: mp4Formats,
            mp3_format: {
                quality: 'best',
                format: 'mp3',
                download_url: `${req.protocol}://${req.get('host')}/api/download?url=${encodeURIComponent(url)}&format=mp3`,
            },
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/metadata/:videoId', async (req, res) => {
    const { videoId } = req.params;
    try {
        const [oembedResult] = await Promise.allSettled([
            fetchJSON(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`),
        ]);

        const meta = {};

        if (oembedResult.status === 'fulfilled') {
            const d = oembedResult.value;
            meta.title = d.title || '';
            meta.author_name = d.author_name || '';
            meta.author_url = d.author_url || '';
            meta.thumbnail_url = d.thumbnail_url || '';
            meta.provider_name = d.provider_name || 'YouTube';
            meta.width = d.width;
            meta.height = d.height;
        }

        meta.embed_url = `https://www.youtubeeducation.com/embed/${videoId}`;
        meta.thumbnail_proxy = `${req.protocol}://${req.get('host')}/api/thumbnail/${videoId}`;

        res.json(meta);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/comments/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const { limit = 30 } = req.query;

    try {
        const data = await fetchJSON(`https://min-tube-api-3.vercel.app/api/comments/${encodeURIComponent(videoId)}`);
        const comments = Array.isArray(data.comments) ? data.comments : [];

        const normalized = comments.slice(0, parseInt(limit)).map(c => ({
            author: c.author || '',
            authorThumbnail: (c.authorThumbnails && c.authorThumbnails[0]?.url) || '',
            content: c.content || '',
            contentHtml: c.contentHtml || '',
            likeCount: c.likeCount || 0,
            likeCountFormatted: formatCount(c.likeCount || 0),
            publishedText: c.publishedText || '',
            verified: c.verified || false,
            isChannelOwner: c.authorIsChannelOwner || false,
            isPinned: c.isPinned || false,
            replyCount: c.replies?.replyCount || 0,
        }));

        res.json({
            videoId,
            commentCount: data.commentCount || 0,
            commentCountFormatted: formatCount(data.commentCount || 0),
            comments: normalized,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/related/:videoId', async (req, res) => {
    const { videoId } = req.params;
    try {
        const meta = await fetchJSON(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`);
        const title = meta.title || '';
        const author = meta.author_name || '';

        const queryParts = [
            author.split(' ').slice(0, 2).join(' '),
            title.split(' ').slice(0, 3).join(' '),
        ].filter(Boolean);
        const query = queryParts.join(' ').trim();

        res.json({
            videoId,
            suggestedQuery: query,
            searchUrl: `${req.protocol}://${req.get('host')}/api/search?q=${encodeURIComponent(`site:youtube.com ${query}`)}`,
            note: 'Use suggestedQuery with your CSE or /api/search to fetch related videos.',
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/thumbnail/:videoId', async (req, res) => {
    const { videoId } = req.params;
    try {
        let result;
        try {
            result = await fetchBuffer(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
            if (result.contentType.includes('image/gif')) throw new Error('gif fallback');
        } catch {
            result = await fetchBuffer(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
        }
        res.set('Content-Type', result.contentType);
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(result.buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/download', async (req, res) => {
    const { url, quality = '720p', format = 'mp4' } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    if (!['mp4', 'mp3'].includes(format)) return res.status(400).json({ error: "format must be 'mp4' or 'mp3'" });

    let videoId = videoIdFromUrl(url);
    if (!videoId) {
        try {
            const raw = await ytdlp([...baseYtdlpArgs(), '--dump-json', '--skip-download', url]);
            videoId = JSON.parse(raw).id;
        } catch (e) {
            return res.status(400).json({ error: 'Could not resolve video ID', detail: e.message });
        }
    }

    const ext = format === 'mp3' ? 'mp3' : 'mp4';
    const outFile = path.join(DOWNLOAD_FOLDER, `${videoId}.${ext}`);

    if (fs.existsSync(outFile)) {
        const mimetype = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
        return res.download(outFile, `${videoId}.${ext}`, { headers: { 'Content-Type': mimetype } });
    }

    try {
        const outputTemplate = toSlash(path.join(DOWNLOAD_FOLDER, `${videoId}.%(ext)s`));
        const args = [...baseYtdlpArgs(), '-o', outputTemplate];

        if (format === 'mp3') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '192K');
        } else {
            const q = quality.replace(/\D/g, '');
            args.push(
                '-f',
                `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`,
                '--merge-output-format', 'mp4'
            );
        }

        args.push(url);

        let ytdlpStderr = null;
        try {
            await ytdlp(args);
        } catch (e) {
            ytdlpStderr = e.message;
        }

        if (fs.existsSync(outFile)) {
            const mimetype = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
            return res.download(outFile, `${videoId}.${ext}`, { headers: { 'Content-Type': mimetype } });
        }

        const allFiles = fs.readdirSync(DOWNLOAD_FOLDER);
        const match = allFiles.find(f => f.startsWith(videoId));
        if (match) {
            const resolvedPath = path.join(DOWNLOAD_FOLDER, match);
            const mimetype = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
            return res.download(resolvedPath, match, { headers: { 'Content-Type': mimetype } });
        }

        return res.status(500).json({
            error: 'Downloaded file not found on disk',
            videoId,
            expected: outFile,
            downloads_dir_contents: allFiles,
            yt_dlp_error: ytdlpStderr,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/scrape', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    try {
        const { html, cookies } = await withCloudflare(url);
        res.json({ url, html, cookies });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/scrape/text', async (req, res) => {
    const { url, selector } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(UA);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);

        let extracted;
        if (selector) {
            extracted = await page.$$eval(selector, els => els.map(el => el.innerText.trim()));
        } else {
            extracted = await page.evaluate(() => document.body.innerText);
        }

        res.json({ url, selector: selector || null, data: extracted });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        await browser.close();
    }
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `The requested URL ${req.path} was not found on this server.`,
    });
});

const PORT = process.env.PORT || 7860;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Download folder: ${DOWNLOAD_FOLDER}`);
    if (!fs.existsSync('cookies.txt')) {
        console.warn('WARNING: cookies.txt not found. Place YouTube cookies there to avoid bot detection.');
    }
});