const fs = require('fs');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('usage: node tools/clean-pdf.js <fichier.pdf>');
  process.exit(0);
}

const input = fs.readFileSync(file);
const output = sanitizePdf(input);

if (Buffer.compare(input, output) === 0) {
  console.log('Aucune metadonnee a masquer.');
  process.exit(0);
}

fs.writeFileSync(file, output);
console.log('Metadonnees masquees (longueur identique, PDF intact).');

function sanitizePdf(inputBuf) {
  try {
    const b = Buffer.from(inputBuf);
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
    return inputBuf;
  }
}
