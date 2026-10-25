const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(404).end();
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || !verify(req, adminPass)) return res.status(404).end();

  const body = req.body || {};
  const u = typeof body.u === 'string' ? body.u.trim() : '';
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return res.status(400).json({ error: 'URL invalide' });

  let frag = await extractArticle(u, 0);
  if (!frag) frag = await readerArticle(u, 0);
  if (!frag) return res.status(502).json({ error: 'Aucun article exploitable sur cette page' });
  return res.status(200).json({ h: frag });
};

async function extractArticle(u, depth) {
  try {
    const html = await getHtml(u);
    if (!html) return null;
    const frag = buildFromHtml(html, u);
    if (frag) return frag;
    if (depth === 0) {
      const link = findArticleLink(html, u);
      if (link && link !== u) return extractArticle(link, 1);
    }
  } catch (e) {}
  return null;
}

async function readerArticle(u, depth) {
  try {
    const md = await getReader(u);
    if (!md) return null;
    const frag = mdToFragment(md, u);
    if (frag) return frag;
    if (depth === 0) {
      const link = findArticleLinkMd(md, u);
      if (link && link !== u) return readerArticle(link, 1);
    }
  } catch (e) {}
  return null;
}

async function getHtml(u) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.8,fr;q=0.6'
      }
    });
    if (!r.ok) return null;
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3000000) buf = buf.slice(0, 3000000);
    let html = buf.toString('utf8');
    const mcs = html.match(/charset=["']?([\w-]+)/i);
    if (mcs && /1256|8859-6/i.test(mcs[1])) {
      try { html = new TextDecoder(mcs[1].toLowerCase()).decode(buf); } catch (e) {}
    }
    return html;
  } finally {
    clearTimeout(to);
  }
}

async function getReader(u) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://r.jina.ai/' + u, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    return await r.text();
  } finally {
    clearTimeout(to);
  }
}

function buildFromHtml(html, u) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  let title = meta(html, 'og:title') || firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  title = decodeEnt(stripTags(title)).replace(/\s+/g, ' ').trim();
  const img = pickImage(html, u);

  const ps = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = decodeEnt(stripTags(m[1])).replace(/\s+/g, ' ').trim();
    if (t.length >= 80 && ps.indexOf(t) === -1 && !junk(t)) ps.push(t);
    if (ps.length >= 12) break;
  }
  if (ps.length < 2) return null;
  return fragment(title, img, ps, u);
}

function mdToFragment(md, u) {
  if (!md) return null;
  let title = '';
  const tm = md.match(/^Title:\s*(.+)$/m);
  if (tm) title = tm[1].trim();
  const body = md.replace(/^Title:.*$/m, '').replace(/^URL Source:.*$/m, '').replace(/^Markdown Content:.*$/m, '');
  const lines = body.split('\n').map(l => l.trim())
    .filter(l => l.length >= 80 && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('>') && !l.startsWith('-') && !l.startsWith('|'));
  const ps = [];
  for (const l of lines) {
    const t = l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
    if (t.length >= 80 && ps.indexOf(t) === -1 && !junk(t)) ps.push(t);
    if (ps.length >= 12) break;
  }
  const img = pickImageMd(md);
  if (ps.length < 2) return null;
  return fragment(title, img, ps, u);
}

function fragment(title, img, ps, u) {
  let out = '';
  if (img) out += '<img class="hero" src="' + escAttr(img) + '" alt="" onerror="this.style.display=\'none\'">\n';
  out += '<h1 class="title">' + escHtml(title || safeHost(u)) + '</h1>\n';
  out += '<div class="meta">' + escHtml(safeHost(u)) + ' <span class="sep">|</span> importé</div>\n';
  for (const p of ps) out += '<p>' + escHtml(p) + '</p>\n';
  return out;
}

function findArticleLink(html, u) {
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const abs = absUrl(u, m[1]);
    if (!abs) continue;
    try {
      const host = new URL(abs).hostname;
      if (host !== safeHost(u) && !host.endsWith('.' + safeHost(u))) continue;
      if (/\/20\d{2}\d{2}\d{2}[-/]/.test(abs) || /\/article\//i.test(abs)) return abs;
    } catch (e) {}
  }
  return '';
}

function findArticleLinkMd(md, u) {
  const re = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const abs = m[1].replace(/\)$/, '');
    try {
      const host = new URL(abs).hostname;
      if (host !== safeHost(u) && !host.endsWith('.' + safeHost(u))) continue;
      if (/\/20\d{2}\d{2}\d{2}[-/]/.test(abs) || /\/article\//i.test(abs)) return abs;
    } catch (e) {}
  }
  return '';
}

function pickImage(html, u) {
  const candidates = [];
  const og = meta(html, 'og:image') || meta(html, 'og:image:secure_url') || meta(html, 'twitter:image');
  if (og) candidates.push(decodeEnt(og));
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const wm = tag.match(/width=["']?(\d+)/i);
    if (wm && parseInt(wm[1], 10) < 300) continue;
    candidates.push(decodeEnt(m[1]));
  }
  for (const c of candidates) {
    const abs = absUrl(u, c);
    if (!abs) continue;
    if (/logo|sprite|favicon|icon|150x150|160x160|avatar|placeholder/i.test(abs)) continue;
    return abs;
  }
  return '';
}

function pickImageMd(md) {
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = re.exec(md))) {
    const abs = m[1];
    if (/logo|sprite|favicon|icon|150x150|160x160|avatar|placeholder/i.test(abs)) continue;
    return abs;
  }
  return '';
}

function meta(html, key) {
  const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*content=["\']([^"\']*)', 'i');
  const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + key + '["\']', 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? m[1].trim() : '';
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ');
}

function junk(t) {
  return /cookie|consent|privacy|publicit|ملفات تعريف|اشترك|اشتراك|تابعنا|النشرة البريدية/i.test(t);
}

function decodeEnt(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

function absUrl(base, src) {
  if (!src) return '';
  src = src.trim();
  if (/^https?:\/\//i.test(src)) return src;
  if (src.indexOf('//') === 0) return 'https:' + src;
  try {
    const o = new URL(base).origin;
    if (src.indexOf('/') === 0) return o + src;
    return o + '/' + src;
  } catch (e) { return ''; }
}

function safeHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'source'; }
}

function verify(req, secret) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)dxy_s=(\d{10,13})\.([a-f0-9]{64})/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!exp || exp * 1000 < Date.now()) return false;
  const expect = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expect, 'hex'));
  } catch (e) {
    return false;
  }
}
