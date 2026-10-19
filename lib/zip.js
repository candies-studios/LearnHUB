'use strict';
// Dependency-free ZIP extractor (stored + deflate), with path-traversal protection.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function extractZip(buf, dest) {
  dest = path.resolve(dest);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  let written = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    off += 46 + nameLen + extraLen + commLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || path.basename(name) === '.DS_Store') continue;
    const target = path.resolve(dest, name);
    if (!target.startsWith(dest + path.sep)) throw new Error('Unsafe path in zip: ' + name);
    const lnl = buf.readUInt16LE(lho + 26);
    const lel = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnl + lel;
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('Unsupported zip compression method ' + method);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return written;
}
module.exports = { extractZip };
