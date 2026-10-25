const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || 'https://invalid.upstash.io',
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'invalid'
});
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(404).end();
  }
  const ip = (req.headers['x-forwarded-for'] || '0.0.0.0').split(',')[0].trim();
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return res.status(404).end();
  }

  let tries = 1;
  try {
    tries = await kv.incr('rl:' + ip);
    if (tries === 1) await kv.expire('rl:' + ip, 300);
  } catch (e) {}

  if (tries > 5) {
    return res.status(404).end();
  }

  const pass = req.body && typeof req.body.p === 'string' ? req.body.p : '';
  if (pass !== adminPass) {
    return res.status(404).end();
  }

  try { await kv.del('rl:' + ip); } catch (e) {}

  const token = crypto.randomBytes(24).toString('hex');
  try {
    await kv.set('sess:' + token, String(Date.now()), { ex: 28800 });
  } catch (e) {
    return res.status(404).end();
  }

  res.setHeader('Set-Cookie',
    'dxy_s=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'
  );
  return res.status(200).json({ ok: 1 });
};
