const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(404).end();
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || !verify(req, adminPass)) return res.status(404).end();

  const body = req.body || {};
  const u = typeof body.u === 'string' ? body.u.trim() : '';
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return res.status(400).json({ error: 'URL invalide' });

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.8,fr;q=0.6'
      }
    });
    clearTimeout(to);
    if (!r.ok) return res.status(502).json({ error: 'Site inaccessible (code ' + r.status + ')' });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3000000) buf = buf.slice(0, 3000000);
    let html = buf.toString('utf8');
    const mcs = html.match(/charset=["']?([\w-]+)/i);
    if (mcs && /1256|8859-6/i.test(mcs[1])) {
      try { html = new TextDecoder(mcs[1].toLowerCase()).decode(buf); } catch (e) {}
    }
    const frag = buildFragment(html, u);
    if (!frag) return res.status(502).json({ error: 'Aucun article exploitable sur cette page' });
    return res.status(200).json({ h: frag });
  } catch (e) {
    return res.status(502).json({ error: 'Erreur de récupération (timeout ou site bloqué)' });
  }
};

function buildFragment(html, u) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  let title = meta(html, 'og:title') || firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  title = decodeEnt(stripTags(title)).replace(/\s+/g, ' ').trim();
  const imgRaw = meta(html, 'og:image') || meta(html, 'twitter:image') || firstMatch(html, /<img[^>]+src=["']([^"']+)["']/i);
  const img = imgRaw ? absUrl(u, decodeEnt(imgRaw)) : '';
  const date = meta(html, 'article:published_time') || firstMatch(html, /<time[^>]+datetime=["']([^"']+)/i) || '';
  const src = safeHost(u);

  const ps = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = decodeEnt(stripTags(m[1])).replace(/\s+/g, ' ').trim();
    if (t.length >= 80 && ps.indexOf(t) === -1) ps.push(t);
    if (ps.length >= 12) break;
  }
  if (!title && ps.length === 0) return null;

  let out = '';
  if (img) out += '<img class="hero" src="' + escAttr(img) + '" alt="">\n';
  out += '<h1 class="title">' + escHtml(title || src) + '</h1>\n';
  out += '<div class="meta">' + escHtml(src) + (date ? ' — ' + escHtml(date.slice(0, 10)) : '') + ' <span class="sep">|</span> importé</div>\n';
  for (const p of ps) out += '<p>' + escHtml(p) + '</p>\n';
  return out;
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
