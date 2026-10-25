const crypto = require('crypto');

const RL = new Map();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(404).end();
  }
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    return res.status(404).end();
  }

  const ip = (req.headers['x-forwarded-for'] || '0.0.0.0').split(',')[0].trim();
  const now = Date.now();
  let rec = RL.get(ip) || { c: 0, t: now };
  if (now - rec.t > 300e3) rec = { c: 0, t: now };
  rec.c += 1;
  rec.t = now;
  RL.set(ip, rec);
  if (rec.c > 5) {
    return res.status(404).end();
  }

  const pass = req.body && typeof req.body.p === 'string' ? req.body.p : '';
  if (pass !== adminPass) {
    await sleep(300);
    return res.status(404).end();
  }
  RL.delete(ip);

  const exp = Math.floor(now / 1000) + 28800;
  const sig = crypto.createHmac('sha256', adminPass).update(String(exp)).digest('hex');

  res.setHeader('Set-Cookie',
    'dxy_s=' + exp + '.' + sig + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'
  );
  return res.status(200).json({ ok: 1 });
};

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}
