'use strict';
// Minimal multipart/form-data parser (whole body in memory).
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('Missing multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const out = { fields: {}, files: [] };
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    if (buf[pos] === 45 && buf[pos + 1] === 45) break; // closing "--"
    pos += 2; // CRLF
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const head = buf.slice(pos, headEnd).toString('utf8');
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next < 0) break;
    const data = buf.slice(headEnd + 4, next - 2);
    const name = (/name="([^"]*)"/i.exec(head) || [])[1];
    const fnm = /filename="([^"]*)"/i.exec(head);
    const type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
    if (fnm) out.files.push({ field: name, filename: fnm[1], type, data });
    else if (name) out.fields[name] = data.toString('utf8');
    pos = next;
  }
  return out;
}
module.exports = { parseMultipart };
