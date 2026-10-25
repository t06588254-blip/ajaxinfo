const crypto = require('crypto');
const { put, get, del } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const html = await readHtml();
    if (!html) return res.status(404).end();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  }

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || !verify(req, adminPass)) {
    return res.status(404).end();
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const h = typeof body.h === 'string' ? body.h : '';
    if (!h.trim()) return res.status(400).end();
    if (h.length > 200000) return res.status(413).end();
    const ok = await writeHtml(h);
    if (!ok) return res.status(500).end();
    return res.status(200).json({ ok: 1 });
  }

  if (req.method === 'DELETE') {
    try { await del('bait/article.html'); } catch (e) {}
    return res.status(200).json({ ok: 1 });
  }

  return res.status(404).end();
};

async function readHtml() {
  try {
    const r = await get('bait/article.html', { access: 'private' });
    if (!r) return null;
    return await new Response(r.stream).text();
  } catch (e) {
    return null;
  }
}

async function writeHtml(h) {
  try {
    await put('bait/article.html', h, {
      access: 'private',
      allowOverwrite: true,
      contentType: 'text/html; charset=utf-8',
      addRandomSuffix: false
    });
    return true;
  } catch (e) {
    console.error('PAGE_WRITE_ERR', e && (e.message || e));
    return false;
  }
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
