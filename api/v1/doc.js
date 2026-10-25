const { kv } = require('@vercel/kv');
const { put, del } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    const meta = await readMeta();
    if (!meta) return res.status(404).end();
    if (req.method === 'HEAD') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end();
    }
    if (meta.url) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, meta.url);
    }
    let b64 = null;
    try { b64 = await kv.get('bait:b64'); } catch (e) { b64 = null; }
    if (!b64) return res.status(404).end();
    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  }

  const token = readToken(req);
  let valid = false;
  try { valid = token ? Boolean(await kv.get('sess:' + token)) : false; } catch (e) { valid = false; }
  if (!valid) return res.status(404).end();

  if (req.method === 'POST') {
    const body = req.body || {};
    const b64 = String(body.b || '').split(',').pop();
    const name = String(body.n || 'document.pdf').replace(/[^\w.\- ]+/g, '').trim().slice(0, 80) || 'document.pdf';
    if (!b64) return res.status(400).end();
    if (b64.length > 4300000) return res.status(413).end();
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).end(); }
    if (!buf || buf.length < 100 || buf.slice(0, 5).toString('latin1') !== '%PDF-') return res.status(400).end();
    buf = sanitizePdf(buf);

    let url = null;
    try {
      const r = await put('bait/' + Date.now() + '.pdf', buf, {
        access: 'public', contentType: 'application/pdf', addRandomSuffix: true
      });
      url = r.url || null;
    } catch (e) { url = null; }

    if (!url) {
      try { await kv.set('bait:b64', buf.toString('base64')); } catch (e) { return res.status(500).end(); }
    } else {
      try { await kv.del('bait:b64'); } catch (e) {}
    }
    const meta = { n: name, sz: buf.length, t: new Date().toISOString(), url: url };
    try { await kv.set('bait:meta', JSON.stringify(meta)); } catch (e) { return res.status(500).end(); }
    return res.status(200).json({ ok: 1, meta: meta });
  }

  if (req.method === 'DELETE') {
    let meta = null;
    try { meta = await readMeta(); } catch (e) { meta = null; }
    try { if (meta && meta.url) await del(meta.url); } catch (e) {}
    try { await kv.del('bait:meta', 'bait:b64'); } catch (e) {}
    return res.status(200).json({ ok: 1 });
  }

  return res.status(404).end();
};

function sanitizePdf(input) {
  try {
    const b = Buffer.from(input);
    const src = b.toString('latin1');
    const keys = ['Author', 'Creator', 'Producer', 'Title', 'Subject', 'Keywords', 'CreationDate', 'ModDate'];
    for (const k of keys) {
      const reP = new RegExp('/' + k + '\\s*\\(', 'g');
      let m;
      while ((m = reP.exec(src))) {
        let i = m.index + m[0].length;
        while (i < b.length && b[i] !== 0x29) {
          if (b[i] === 0x5C && i + 1 < b.length) {
            b[i] = 0x20;
            b[i + 1] = 0x20;
            i += 2;
          } else {
            b[i] = 0x20;
            i++;
          }
        }
        reP.lastIndex = i + 1;
      }
      const reH = new RegExp('/' + k + '\\s*<', 'g');
      while ((m = reH.exec(src))) {
        let i = m.index + m[0].length;
        while (i < b.length && b[i] !== 0x3E) {
          if (b[i] !== 0x20 && b[i] !== 0x0A && b[i] !== 0x0D && b[i] !== 0x09) b[i] = 0x30;
          i++;
        }
        reH.lastIndex = i + 1;
      }
    }
    const x1 = src.indexOf('<x:xmpmeta');
    if (x1 !== -1) {
      const x2 = src.indexOf('</x:xmpmeta>', x1);
      const end = x2 !== -1 ? x2 + 12 : Math.min(x1 + 8192, b.length);
      for (let i = x1; i < end && i < b.length; i++) b[i] = 0x20;
    } else {
      const r1 = src.indexOf('<rdf:RDF');
      if (r1 !== -1) {
        const r2 = src.indexOf('</rdf:RDF>', r1);
        const end = r2 !== -1 ? r2 + 10 : Math.min(r1 + 8192, b.length);
        for (let i = r1; i < end && i < b.length; i++) b[i] = 0x20;
      }
    }
    return b;
  } catch (e) {
    return input;
  }
}

async function readMeta() {
  try {
    const raw = await kv.get('bait:meta');
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) { return null; }
}

function readToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)dxy_s=([a-f0-9]{48})/);
  return m ? m[1] : null;
}
