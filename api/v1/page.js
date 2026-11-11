const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || 'https://invalid.upstash.io',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || 'invalid'
});

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    let html = null;
    try { html = await kv.get('pv:bait'); } catch (e) { html = null; }
    if (!html) return res.status(404).end();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  }

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || !verify(req, adminPass)) return res.status(404).end();

  if (req.method === 'POST') {
    const body = req.body || {};
    const h = typeof body.h === 'string' ? body.h : '';
    if (!h.trim()) return res.status(400).end();
    if (h.length > 200000) return res.status(413).end();
    try { await kv.set('pv:bait', h); } catch (e) { console.error('PAGE_WRITE_ERR', e && (e.message || e)); return res.status(500).end(); }
    return res.status(200).json({ ok: 1 });
  }

  if (req.method === 'DELETE') {
    try { await kv.del('pv:bait'); } catch (e) { console.error('PAGE_DEL_ERR', e && (e.message || e)); }
    return res.status(200).json({ ok: 1 });
  }

  return res.status(404).end();
};

function verify(req, secret) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)dxy_s=(\d{10,13})\.([a-f0-9]{64})/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!exp || exp * 1000 < Date.now()) return false;
  const expect = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expect, 'hex')); } catch (e) { return false; }
}
