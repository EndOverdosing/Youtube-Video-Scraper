const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const yts = require('youtube-search-api');
const cookieParser = require('cookie-parser');

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 7860;
const DOWNLOAD_FOLDER = path.resolve('downloads');
if (!fs.existsSync(DOWNLOAD_FOLDER)) fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });

const RAPID_API_HOST = 'ytstream-download-youtube-videos.p.rapidapi.com';
const API_HEALTH_CHECKER = 'https://raw.githubusercontent.com/Minotaur-ZAOU/test/refs/heads/main/min-tube-api.json';

const RAPID_KEYS = [
    process.env.RAPIDAPI_KEY_1 || '69e2995a79mshcb657184ba6731cp16f684jsn32054a070ba5',
    process.env.RAPIDAPI_KEY_2 || 'ece95806fdmshe322f47bce30060p1c3411jsn41a3d4820039',
    process.env.RAPIDAPI_KEY_3 || '41c9265bc6msha0fa7dfc1a63eabp18bf7cjsne6ef10b79b38',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

const DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-us,en;q=0.5',
    'Sec-Fetch-Mode': 'navigate',
};

const videoCache = new Map();
let apiListCache = [];

function toSlash(p) {
    return p.replace(/\\/g, '/');
}

function fetchWithTimeout(url, options = {}, timeout = 5000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
    ]);
}

async function updateApiListCache() {
    try {
        const response = await fetch(API_HEALTH_CHECKER);
        if (response.ok) {
            const list = await response.json();
            if (Array.isArray(list) && list.length > 0) {
                apiListCache = list;
            }
        }
    } catch (e) { }
}

updateApiListCache();
setInterval(updateApiListCache, 1000 * 60 * 10);

setInterval(() => {
    const now = Date.now();
    for (const [id, item] of videoCache.entries()) {
        if (item.expiry < now) videoCache.delete(id);
    }
}, 300000);

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
            trending: '/api/trending?page=0',
            search: '/api/search?q=QUERY&page=0',
            recommendations: '/api/recommendations?title=TITLE&channel=CHANNEL&id=VIDEO_ID',
            channel: '/api/channel?name=CHANNEL_NAME&page=0',
            invChannel: '/api/inv/channel/CHANNEL_NAME',
            stream360: '/360/VIDEO_ID',
            streamInv: '/stream/inv/VIDEO_ID',
            rapid: '/rapid/VIDEO_ID',
            siaDl: '/sia-dl/VIDEO_ID',
            aiFetch: '/ai-fetch/VIDEO_ID',
            nocookie: '/nocookie/VIDEO_ID',
            scratchEdu: '/scratch-edu/VIDEO_ID',
            kahootEdu: '/kahoot-edu/VIDEO_ID',
            proStream: '/pro-stream/VIDEO_ID',
            cacheList: '/streams',
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

app.get('/api/trending', async (req, res) => {
    const page = parseInt(req.query.page) || 0;
    const seeds = [
        'MrBeast', 'music video 2025', 'gaming highlights',
        'news today', 'viral 2025', 'top songs 2025',
        'funny moments', 'new movie trailer', 'sports highlights',
        'cooking recipe', 'travel vlog', 'tech review 2025',
    ];
    const seed1 = seeds[(page * 2) % seeds.length];
    const seed2 = seeds[(page * 2 + 1) % seeds.length];
    try {
        const [r1, r2] = await Promise.allSettled([
            yts.GetListByKeyword(seed1, false, 25),
            yts.GetListByKeyword(seed2, false, 25),
        ]);
        const items1 = r1.status === 'fulfilled' ? (r1.value.items || []) : [];
        const items2 = r2.status === 'fulfilled' ? (r2.value.items || []) : [];
        const combined = [...items1, ...items2];
        const seen = new Set();
        const final = [];
        for (const item of combined) {
            if (item.type === 'video' && item.id && !seen.has(item.id)) {
                seen.add(item.id);
                final.push(item);
            }
        }
        console.log(`[trending] page=${page} seeds="${seed1}","${seed2}" got ${combined.length} raw, ${final.length} videos`);
        res.json({ items: final.sort(() => 0.5 - Math.random()) });
    } catch (e) {
        console.error('[trending] error:', e.message);
        res.json({ items: [], error: e.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { q, page = 0 } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    try {
        const results = await yts.GetListByKeyword(q, false, 20, page);
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/recommendations', async (req, res) => {
    const { title, channel, id } = req.query;
    if (!title || !channel || !id) return res.status(400).json({ error: 'title, channel, and id required' });
    try {
        const clean = title.replace(/[[\]()!?]/g, ' ').replace(/\s+/g, ' ').trim();
        const words = clean.split(' ').filter(w => w.length >= 2);
        const mainTopic = words.length > 0 ? words.slice(0, 2).join(' ') : clean;
        const [r1, r2, r3] = await Promise.all([
            yts.GetListByKeyword(mainTopic, false, 12),
            yts.GetListByKeyword(channel, false, 8),
            yts.GetListByKeyword(`${mainTopic} related`, false, 8),
        ]);
        const raw = [...(r1.items || []), ...(r2.items || []), ...(r3.items || [])];
        const seenIds = new Set([id]);
        const seenTitles = new Set();
        const final = [];
        for (const item of raw) {
            if (!item.id || item.type !== 'video' || seenIds.has(item.id)) continue;
            const normalized = item.title.toLowerCase()
                .replace(/\s+/g, '')
                .replace(/official|lyrics|mv|musicvideo|video/g, '');
            const sig = normalized.substring(0, 12);
            if (seenTitles.has(sig)) continue;
            seenIds.add(item.id);
            seenTitles.add(sig);
            final.push(item);
            if (final.length >= 24) break;
        }
        res.json({ items: final.sort(() => 0.5 - Math.random()) });
    } catch (e) {
        res.json({ items: [] });
    }
});

app.get('/api/channel', async (req, res) => {
    const channelName = req.query.name || req.query.id;
    const page = parseInt(req.query.page) || 0;
    if (!channelName) return res.status(400).json({ error: 'name required' });
    try {
        const results = await yts.GetListByKeyword(channelName, false, 30, page);
        const videos = (results.items || []).filter(item => item.type === 'video');
        res.json({ channelName, videos, nextPage: page + 1 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/inv/channel/:name', async (req, res) => {
    const channelName = req.params.name;
    const url = `https://inv.vern.cc/api/v1/search?q=${encodeURIComponent(channelName)}&type=channel`;
    try {
        const response = await fetch(url);
        if (!response.ok) return res.status(response.status).json({ error: `Upstream error: ${response.statusText}` });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/streams', (req, res) => {
    res.json(Object.fromEntries(videoCache));
});

app.get('/rapid/:id', async (req, res) => {
    const videoId = req.params.id;
    const selectedKey = RAPID_KEYS[Math.floor(Math.random() * RAPID_KEYS.length)];
    const url = `https://${RAPID_API_HOST}/dl?id=${videoId}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': selectedKey,
                'x-rapidapi-host': RAPID_API_HOST,
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json();
        if (data.status !== 'OK') return res.status(400).json({ error: 'Failed to fetch video data' });
        let channelImageUrl = data.channelThumbnail?.[0]?.url || data.author?.thumbnails?.[0]?.url;
        if (!channelImageUrl) {
            const name = encodeURIComponent(data.channelTitle || 'Channel');
            channelImageUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
        }
        const highResStream = data.adaptiveFormats?.find(f => f.qualityLabel === '1080p') || data.adaptiveFormats?.[0];
        const audioStream = data.adaptiveFormats?.find(f => f.mimeType?.includes('audio')) || data.adaptiveFormats?.[data.adaptiveFormats?.length - 1];
        res.json({
            stream_url: data.formats?.[0]?.url || '',
            highstreamUrl: highResStream?.url || '',
            audioUrl: audioStream?.url || '',
            videoId: data.id,
            channelId: data.channelId,
            channelName: data.channelTitle,
            channelImage: channelImageUrl,
            videoTitle: data.title,
            videoDes: data.description,
            videoViews: parseInt(data.viewCount) || 0,
            likeCount: data.likeCount || 0,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/360/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const now = Date.now();
    const cached = videoCache.get(videoId);
    if (cached && cached.expiry > now) return res.type('text/plain').send(cached.url);
    const _0x1a = [0x79, 0x85, 0x85, 0x81, 0x84, 0x4b, 0x40, 0x40, 0x78, 0x76, 0x85, 0x7d, 0x72, 0x85, 0x76, 0x3f, 0x75, 0x76, 0x87, 0x40, 0x72, 0x81, 0x7a, 0x40, 0x85, 0x80, 0x80, 0x7d, 0x84, 0x40, 0x8a, 0x80, 0x86, 0x85, 0x86, 0x73, 0x76, 0x3e, 0x7d, 0x7a, 0x87, 0x76, 0x3e, 0x75, 0x80, 0x88, 0x7f, 0x7d, 0x80, 0x72, 0x75, 0x76, 0x83, 0x50, 0x86, 0x83, 0x7d, 0x4e, 0x79, 0x85, 0x85, 0x81, 0x84, 0x36, 0x44, 0x52, 0x36, 0x43, 0x57, 0x36, 0x43, 0x57, 0x88, 0x88, 0x88, 0x3f, 0x8a, 0x80, 0x86, 0x85, 0x86, 0x73, 0x76, 0x3f, 0x74, 0x80, 0x7e, 0x36, 0x43, 0x57, 0x88, 0x72, 0x85, 0x74, 0x79, 0x36, 0x44, 0x57, 0x87, 0x36, 0x44, 0x55];
    const _0x2b = [0x37, 0x77, 0x80, 0x83, 0x7e, 0x72, 0x85, 0x5a, 0x75, 0x4e, 0x43];
    const _0x11 = ['\x6d\x61\x70', '\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65', '\x6a\x6f\x69\x6e'];
    const _0x4d = _0x1a[_0x11[0]](_0x5e => String[_0x11[1]](_0x5e - 0x11))[_0x11[2]]('');
    const _0x5e = _0x2b[_0x11[0]](_0x6f => String[_0x11[1]](_0x6f - 0x11))[_0x11[2]]('');
    const targetUrl = _0x4d + videoId + _0x5e;
    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' },
            redirect: 'follow',
        });
        const finalUrl = response.url;
        videoCache.set(videoId, { url: finalUrl, expiry: now + 60000 });
        res.type('text/plain').send(finalUrl);
    } catch (e) {
        res.status(500).send('Internal Server Error');
    }
});

app.get('/stream/inv/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const now = Date.now();
    if (videoCache.has(videoId)) {
        const cached = videoCache.get(videoId);
        if (now < cached.expiry) return res.type('text/plain').send(cached.url);
    }
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
        const configRes = await fetch('https://raw.githubusercontent.com/mino-hobby-pro/min-tube-pro-local-txt/refs/heads/main/inv-check.txt');
        const extraParams = (await configRes.text()).trim();
        const targetUrl = `https://yt-comp5.chocolatemoo53.com/companion/latest_version?id=${videoId}${extraParams}`;
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': randomUA, 'Accept': '*/*' },
            redirect: 'follow',
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const finalUrl = response.url;
        videoCache.set(videoId, { url: finalUrl, expiry: now + 60000 });
        res.type('text/plain').send(finalUrl);
    } catch (e) {
        res.status(500).send('Internal Server Error');
    }
});

app.get('/sia-dl/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const protocol = req.protocol;
    const host = req.get('host');
    try {
        const metaRes = await fetch(`https://siawaseok.duckdns.org/api/video2/${videoId}?depth=1`);
        if (!metaRes.ok) throw new Error('Metadata API response was not ok');
        const data = await metaRes.json();
        const streamRes = await fetch(`${protocol}://${host}/360/${videoId}`);
        const rawStreamUrl = streamRes.ok ? await streamRes.text() : '';
        const parseCount = str => parseInt((str || '').replace(/[^0-9]/g, '')) || 0;
        res.json({
            stream_url: rawStreamUrl.trim(),
            highstreamUrl: rawStreamUrl.trim(),
            audioUrl: '',
            videoId: data.id,
            channelId: data.author?.id || '',
            channelName: data.author?.name || '',
            channelImage: data.author?.thumbnail || '',
            videoTitle: data.title,
            videoDes: data.description?.text || '',
            videoViews: parseCount(data.views || data.extended_stats?.views_original),
            likeCount: parseCount(data.likes),
        });
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error', message: e.message });
    }
});

app.get('/ai-fetch/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const apiUrl = 'https://api.aijimi.com/get?code=get-youtube-videodata&text=' + videoId;
    try {
        const response = await fetch(apiUrl);
        const textData = await response.text();
        const descriptionMatch = textData.match(/Description:\s*([\s\S]*?)\s*Published:/);
        const viewsMatch = textData.match(/View count:\s*(\d+)/);
        const likesMatch = textData.match(/Like count:\s*(\d+)/);
        const videoDes = descriptionMatch ? descriptionMatch[1].trim() : '';
        const videoViews = viewsMatch ? parseInt(viewsMatch[1]) : 0;
        const likeCount = likesMatch ? parseInt(likesMatch[1]) : 0;
        let videoTitle = videoId;
        let channelName = videoId;
        let found = false;
        try {
            const noEmbedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
            if (noEmbedRes.ok) {
                const noEmbedData = await noEmbedRes.json();
                if (noEmbedData && !noEmbedData.error) {
                    videoTitle = noEmbedData.title || videoId;
                    channelName = noEmbedData.author_name || videoId;
                    found = true;
                }
            }
        } catch { }
        if (!found) {
            try {
                let page = 0;
                while (page < 10 && !found) {
                    const searchResults = await yts.GetListByKeyword(videoId, false, 20, page);
                    if (searchResults?.items?.length > 0) {
                        const match = searchResults.items.find(item => item.id === videoId);
                        if (match) {
                            videoTitle = match.title || videoId;
                            channelName = match.author?.name || videoId;
                            found = true;
                        }
                    } else break;
                    page++;
                }
            } catch { }
        }
        const protocol = req.protocol;
        const host = req.get('host');
        let finalStreamUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const internalRes = await fetch(`${protocol}://${host}/360/${videoId}`, { signal: controller.signal });
            if (internalRes.ok) {
                const rawText = await internalRes.text();
                if (rawText && rawText.trim() !== '') finalStreamUrl = rawText.trim();
            }
            clearTimeout(timeoutId);
        } catch { }
        res.json({
            stream_url: finalStreamUrl,
            highstreamUrl: finalStreamUrl,
            audioUrl: finalStreamUrl,
            videoId,
            channelId: '',
            channelName,
            channelImage: `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}&background=random&color=fff&size=128`,
            videoTitle,
            videoDes,
            videoViews,
            likeCount,
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch video data' });
    }
});

app.get('/nocookie/:id', (req, res) => {
    const id = req.params.id;
    const url = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(url);
});

app.get('/scratch-edu/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const configRes = await fetch('https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json');
        const config = await configRes.json();
        const url = `https://www.youtubeeducation.com/embed/${id}${config.params}`;
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(url);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/kahoot-edu/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const paramRes = await fetch('https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/1.txt');
        const params = await paramRes.text();
        const url = `https://www.youtubeeducation.com/embed/${id}${params}`;
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(url);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/pro-stream/:videoId', (req, res) => {
    const videoId = req.params.videoId;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Pro Stream — ${videoId}</title>
<style>
  :root{--bg:#000814;--accent:#00e5ff;--muted:#9fb6c8}
  html,body{height:100%;margin:0;background:radial-gradient(ellipse at center,rgba(0,8,20,1) 0%,rgba(0,4,10,1) 70%);font-family:Inter,system-ui,sans-serif;color:#e6f7ff}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .frame{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
  .layer{position:absolute;inset:0;transition:opacity .8s cubic-bezier(.2,.9,.2,1),transform .8s;display:flex;align-items:center;justify-content:center}
  .layer iframe{width:100%;height:100%;border:0;display:block}
  .layer.inactive{opacity:0;transform:scale(1.02);pointer-events:none}
  .layer.active{opacity:1;transform:scale(1);pointer-events:auto}
  .hud{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:80;display:flex;flex-direction:column;align-items:center;gap:14px;backdrop-filter:blur(6px)}
  .card{min-width:360px;max-width:88vw;padding:18px 20px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.35));box-shadow:0 10px 40px rgba(0,0,0,0.6);color:#dff9ff}
  .title{font-size:18px;font-weight:700;color:var(--accent);letter-spacing:0.6px}
  .status{margin-top:8px;font-size:14px;font-weight:600}
  .sub{margin-top:6px;font-size:13px;color:var(--muted);line-height:1.4}
  .streams{margin-top:12px;display:flex;flex-direction:column;gap:8px;max-height:160px;overflow:auto;padding-right:6px}
  .stream-item{display:flex;justify-content:space-between;align-items:center;padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);font-size:13px}
  .stream-item.ok{border-left:4px solid #2ee6a7}
  .stream-item.fail{opacity:0.6;border-left:4px solid #ff6b6b}
  .progress{height:6px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;margin-top:10px}
  .bar{height:100%;width:0%;background:linear-gradient(90deg,var(--accent),#2ee6a7)}
  @media(max-width:720px){.card{min-width:300px;padding:14px}.title{font-size:16px}}
</style>
</head>
<body>
<div class="stage">
  <div class="frame" id="frame"></div>
  <div class="hud" id="hud">
    <div class="card" id="card">
      <div class="title">Pro Stream — Loading</div>
      <div class="status" id="status">Initializing...</div>
      <div class="sub" id="sub">Connecting to endpoints</div>
      <div class="progress" aria-hidden="true"><div class="bar" id="progressBar"></div></div>
      <div class="streams" id="streamsList" aria-live="polite"></div>
    </div>
  </div>
</div>
<script>
const VIDEO_ID = ${JSON.stringify(videoId)};
const ENDPOINTS = [
  {name:'/scratch-edu',path:'/scratch-edu/'+VIDEO_ID},
  {name:'/kahoot-edu',path:'/kahoot-edu/'+VIDEO_ID},
  {name:'/nocookie',path:'/nocookie/'+VIDEO_ID}
];
const PLAYABLE_TIMEOUT = 9000;
const frame = document.getElementById('frame');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const subEl = document.getElementById('sub');
const streamsList = document.getElementById('streamsList');
const progressBar = document.getElementById('progressBar');
let layers = [];
let activeIndex = 0;
function setStatus(main,sub){statusEl.textContent=main;subEl.textContent=sub||'';}
function setProgress(p){progressBar.style.width=Math.max(0,Math.min(1,p))*100+'%';}
function upsertStreamRow(name,url,state,note){
  let el=document.querySelector('[data-stream="'+name+'"]');
  if(!el){el=document.createElement('div');el.className='stream-item';el.dataset.stream=name;el.innerHTML='<div><strong>'+name+'</strong><div style="font-size:12px;color:var(--muted)">'+(url||'')+'</div></div><div class="state"></div>';streamsList.appendChild(el);}
  el.querySelector('.state').textContent=note||(state==='ok'?'OK':'Failed');
  el.classList.toggle('ok',state==='ok');el.classList.toggle('fail',state!=='ok');
}
async function fetchAllUrls(){
  setStatus('Fetching URLs','Querying each endpoint');
  const results=[];
  for(let i=0;i<ENDPOINTS.length;i++){
    const ep=ENDPOINTS[i];
    upsertStreamRow(ep.name,'','pending','Querying...');
    try{
      const res=await fetch(ep.path,{cache:'no-store'});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const text=(await res.text()).trim();
      if(text){results.push({name:ep.name,url:text,ok:true});upsertStreamRow(ep.name,text,'ok','URL fetched');}
      else{results.push({name:ep.name,url:null,ok:false});upsertStreamRow(ep.name,'','fail','Empty response');}
    }catch(err){results.push({name:ep.name,url:null,ok:false});upsertStreamRow(ep.name,'','fail',err.message||'Failed');}
    setProgress((i+1)/ENDPOINTS.length*0.4);
  }
  return results;
}
function createLayer(name,url,idx){
  const layer=document.createElement('div');layer.className='layer inactive';layer.style.zIndex=10+idx;layer.dataset.name=name;
  const iframe=document.createElement('iframe');iframe.setAttribute('allow','autoplay; fullscreen; picture-in-picture');iframe.setAttribute('allowfullscreen','');
  try{const u=new URL(url,location.href);if(!u.searchParams.has('autoplay'))u.searchParams.set('autoplay','1');if(!u.searchParams.has('mute'))u.searchParams.set('mute','1');iframe.src=u.toString();}
  catch(e){iframe.src=url+(url.includes('?')?'&':'?')+'autoplay=1&mute=1';}
  layer.appendChild(iframe);frame.appendChild(layer);
  return{name,url,el:layer,iframe,state:'init',ok:false};
}
function initGenericIframe(layerObj){
  return new Promise(resolve=>{
    const iframe=layerObj.iframe;let resolved=false;
    const onLoad=()=>{if(resolved)return;resolved=true;layerObj.state='loaded';layerObj.ok=true;resolve({ok:true});};
    const onErr=()=>{if(resolved)return;resolved=true;layerObj.state='error';layerObj.ok=false;resolve({ok:false});};
    iframe.addEventListener('load',onLoad,{once:true});
    setTimeout(()=>{if(!resolved)onErr();},PLAYABLE_TIMEOUT);
  });
}
async function initLayers(results){
  setStatus('Initializing embeds','Generating players');
  const valid=results.filter(r=>r.ok&&r.url);
  if(valid.length===0){setStatus('No playable streams found','Try a different video ID');setProgress(1);return;}
  setStatus('Testing embed candidates','Selecting first playable stream');setProgress(0.4);
  let chosen=null;
  for(let i=0;i<valid.length;i++){
    const r=valid[i];upsertStreamRow(r.name,r.url,'pending','Testing embed...');
    const obj=createLayer(r.name,r.url,0);const check=await initGenericIframe(obj);
    if(check&&check.ok){chosen=obj;upsertStreamRow(r.name,r.url,'ok','Loaded (selected)');break;}
    else{try{obj.el.remove();}catch(e){}upsertStreamRow(r.name,r.url,'fail','Embed failed');}
    setProgress(0.4+(i+1)/valid.length*0.2);
  }
  if(!chosen){setStatus('All embeds failed','Try a different video ID');setProgress(1);return;}
  layers=[chosen];activeIndex=0;updateLayerVisibility();setProgress(0.85);
  setStatus('Starting autoplay','Playing muted');try{chosen.iframe.focus();}catch(e){}
  setTimeout(()=>{setProgress(1);setStatus('Ready','Tap the screen to enable audio');hud.style.transition='opacity .8s ease';hud.style.opacity='0';setTimeout(()=>{hud.style.display='none';},900);},900);
}
function updateLayerVisibility(){
  layers.forEach((l,i)=>{if(i===activeIndex){l.el.classList.remove('inactive');l.el.classList.add('active');}else{l.el.classList.remove('active');l.el.classList.add('inactive');}});
}
function showNext(){if(layers.length<=1)return;activeIndex=(activeIndex+1)%layers.length;updateLayerVisibility();}
(async function main(){
  try{setStatus('Initializing','Querying endpoints');const results=await fetchAllUrls();setStatus('URLs fetched','Initializing embeds');await initLayers(results);}
  catch(err){setStatus('An error occurred',String(err));}
})();
frame.addEventListener('click',()=>{
  if(hud.style.display!=='none'){hud.style.display='none';layers.forEach(l=>{try{l.iframe.focus();}catch(e){}});}
  else{showNext();}
});
</script>
</body>
</html>`);
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `The requested URL ${req.path} was not found on this server.`,
    });
});

app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Download folder: ${DOWNLOAD_FOLDER}`);
    if (!fs.existsSync('cookies.txt')) {
        console.warn('WARNING: cookies.txt not found. Place YouTube cookies there to avoid bot detection.');
    }
});