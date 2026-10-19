'use strict';
// Small pure helpers shared by server and browser builds.
function fail(status, msg) { throw Object.assign(new Error(msg), { status }); }
function csvEscape(v) {
  v = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows) { return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'; }
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
function safeName(n) { return String(n || 'file').replace(/[^\w.\-]+/g, '_').slice(-80); }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
module.exports = { fail, csvEscape, toCsv, parseCsv, safeName, esc };
