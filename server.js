const express = require('express');
const rateLimit = require('express-rate-limit');
const { Readable } = require('stream');
const path = require('path');
const { makeZip } = require('./zip');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy

// One address per page, for SEO: send other hosts and .html paths to the main domain
const MAIN = 'saatik.site';
const OLD = ['saatiktokvideodownloader.hassanwebdev.site', 'www.saatik.site'];
app.use((req, res, next) => {
  const host = req.hostname || '';
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  let path = req.path;
  if (/\.html$/.test(path)) path = path.replace(/index\.html$/, '').replace(/\.html$/, '') || '/';
  const wrongHost = OLD.includes(host) || host.endsWith('.up.railway.app');
  if (wrongHost || path !== req.path) return res.redirect(301, 'https://' + MAIN + path + q);
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json({ limit: '50kb' }));
const limiter = limit => rateLimit({ windowMs: 60000, limit, standardHeaders: true, legacyHeaders: false, message: { code: 'busy', error: 'Too many requests. Try again in a minute.' } });
app.use('/api/info', limiter(20));
app.use('/api/download', limiter(150)); // a ZIP of a big photo post fetches many images

const API = 'https://www.tikwm.com/api/?hd=1&url=';
const ALLOWED = /(^|\.)(tikwm\.com|tiktokcdn\.com|tiktokcdn-us\.com|muscdn\.com)$/;
const abs = p => (!p ? null : p.startsWith('http') ? p : 'https://www.tikwm.com' + p);

function isTikTok(v) {
  try {
    const u = new URL(v);
    return ['http:', 'https:'].includes(u.protocol) && /(^|\.)tiktok\.com$/.test(u.hostname);
  } catch { return false; }
}

// Only fetch from known media hosts (prevents the server being used as an open proxy)
async function safeFetch(url, hops = 0) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED.test(u.hostname)) throw new Error('blocked host');
  const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const loc = r.headers.get('location');
  if (r.status >= 300 && r.status < 400 && loc && hops < 3) return safeFetch(new URL(loc, u).href, hops + 1);
  return r;
}

// --- lookup helper: one request at a time (>=1.1s apart), retry, 10-minute cache, real errors in the logs ---
const cache = new Map();
let lastCall = 0, chain = Promise.resolve();
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}
async function lookup(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < 600000) return hit.d;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await throttled(() => fetch(API + encodeURIComponent(url), {
        signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SaatikBot/1.0)' }
      }));
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch { console.error('lookup: not JSON, status', r.status, text.slice(0, 120)); continue; }
      if (j.data) {
        cache.set(url, { t: Date.now(), d: j.data });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        return j.data;
      }
      console.error('lookup: provider said', j.code, j.msg);
      if (/limit|busy|try again/i.test(String(j.msg || ''))) continue;
      return null; // post really not available
    } catch (e) { console.error('lookup: request failed:', e.message); }
  }
  throw new Error('upstream unavailable');
}

app.get('/api/info', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isTikTok(url)) return res.status(400).json({ code: 'invalid', error: 'Paste a valid TikTok link.' });
  try {
    const d = await lookup(url);
    const images = d && Array.isArray(d.images) ? d.images.map(abs).filter(Boolean) : [];
    if (!d || (!d.play && !images.length)) return res.status(404).json({ code: 'notfound', error: 'Post not found. It may be private or removed.' });
    res.json({
      title: d.title || 'TikTok video',
      author: (d.author && (d.author.nickname || d.author.unique_id)) || '',
      cover: abs(d.cover),
      duration: d.duration || 0,
      images,
      video: images.length ? null : abs(d.play),
      hd: images.length ? null : abs(d.hdplay),
      music: abs(d.music)
    });
  } catch {
    res.status(502).json({ code: 'busy', error: 'The service is busy. Try again in a moment.' });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const r = await safeFetch(String(req.query.u || ''));
    if (!r.ok || !r.body) return res.status(502).send('Download failed. Go back and try again.');
    let ext = ['mp3', 'jpg'].includes(req.query.e) ? req.query.e : 'mp4';
    const name = String(req.query.n || 'tiktok').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'tiktok';
    let type = ext === 'mp3' ? 'audio/mpeg' : ext === 'jpg' ? (r.headers.get('content-type') || 'image/jpeg') : 'video/mp4';
    if (ext === 'jpg') {
      if (/webp/.test(type)) ext = 'webp';
      else if (/png/.test(type)) ext = 'png';
      else if (!/^image\//.test(type)) type = 'image/jpeg';
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${name}.${ext}"`);
    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.on('close', () => { try { r.body.cancel(); } catch {} });
    Readable.fromWeb(r.body).pipe(res);
  } catch {
    if (!res.headersSent) res.status(400).send('Bad link.');
  }
});

// Several photos -> one ZIP file
app.post('/api/zip', async (req, res) => {
  try {
    const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls.slice(0, 40) : [];
    if (!urls.length) return res.status(400).json({ code: 'invalid', error: 'No photos.' });
    const files = []; let total = 0;
    for (let i = 0; i < urls.length; i += 5) {
      const got = await Promise.all(urls.slice(i, i + 5).map(async (u, j) => {
        const r = await safeFetch(String(u));
        if (!r.ok) throw new Error('fetch failed');
        const ct = r.headers.get('content-type') || '';
        const ext = /webp/.test(ct) ? 'webp' : /png/.test(ct) ? 'png' : 'jpg';
        return { name: 'photo-' + String(i + j + 1).padStart(2, '0') + '.' + ext, data: Buffer.from(await r.arrayBuffer()) };
      }));
      for (const f of got) { total += f.data.length; if (total > 80 * 1024 * 1024) throw new Error('too big'); files.push(f); }
    }
    const name = String(req.body.name || 'tiktok-photos').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'tiktok-photos';
    const zip = makeZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.setHeader('Content-Length', zip.length);
    res.end(zip);
  } catch {
    if (!res.headersSent) res.status(502).json({ code: 'busy', error: 'Could not prepare the ZIP.' });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Running'));
