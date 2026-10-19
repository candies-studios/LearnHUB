'use strict';
// Printable certificate page (A4 landscape) with verification status. Shared by server and browser builds.
const { db } = require('./db');
const C = require('./core');
const { esc } = require('./util');

function certHtml(code, verifyBase) {
  const cert = db.certificates.find((c) => c.code === code);
  const s = db.settings;
  if (!cert) { return (`<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;padding:40px"><h2>Certificate not found</h2><p>No certificate with ID <b>${esc(code)}</b> exists.</p>`); }
  const st = C.certStatus(cert);
  const u = C.userById(cert.userId) || { name: cert.userName };
  const c = C.courseById(cert.courseId) || { title: cert.courseTitle };
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const verifyUrl = verifyBase + cert.code;
  const banner = { valid: ['#e6f4ea', '#137333', 'Valid certificate'], expiring: ['#fef7e0', '#a56300', 'Valid — expires soon'], expired: ['#fce8e6', '#c5221f', 'Expired — recertification required'], revoked: ['#fce8e6', '#c5221f', 'Revoked' + (cert.revokedReason ? ': ' + cert.revokedReason : '')] }[st];
  return (`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Certificate ${esc(cert.code)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}body{margin:0;background:#eef1f5;font-family:Inter,system-ui,sans-serif;color:#1d2733}
.bar{max-width:1100px;margin:20px auto 0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:0 16px}
.status{padding:8px 14px;border-radius:8px;font-weight:600;font-size:14px;background:${banner[0]};color:${banner[1]}}
button{font:inherit;padding:9px 18px;border-radius:8px;border:0;background:${esc(s.brandColor)};color:#fff;font-weight:600;cursor:pointer}
.wrap{padding:16px;display:flex;justify-content:center}
.cert{width:1060px;max-width:100%;aspect-ratio:297/210;background:#fff;position:relative;padding:5.5% 7%;box-shadow:0 10px 40px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden}
.cert:before{content:"";position:absolute;inset:18px;border:2px solid ${esc(s.brandColor)};opacity:.9}
.cert:after{content:"";position:absolute;inset:26px;border:1px solid ${esc(s.brandColor)};opacity:.35}
.org{font-weight:600;letter-spacing:.25em;text-transform:uppercase;font-size:13px;color:${esc(s.brandColor)}}
h1{font-family:'Cormorant Garamond',serif;font-weight:700;font-size:54px;margin:18px 0 4px;letter-spacing:.02em}
.sub{font-size:14px;color:#5f6b7a;letter-spacing:.12em;text-transform:uppercase}
.name{font-family:'Cormorant Garamond',serif;font-size:46px;font-weight:700;margin:26px 0 6px;border-bottom:1px solid #c8ced6;padding:0 40px 6px}
.txt{color:#46515e;font-size:15px;margin:10px 0}
.course{font-size:24px;font-weight:600;margin:4px 0 0;max-width:80%}
.meta{display:flex;gap:56px;margin-top:auto;width:100%;justify-content:space-between;align-items:flex-end;font-size:12.5px;color:#46515e}
.meta b{display:block;color:#1d2733;font-size:14px;margin-bottom:2px}
.sig{border-top:1px solid #1d2733;padding-top:6px;min-width:220px}
.seal{width:92px;height:92px;border-radius:50%;background:${esc(s.brandColor)};color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;font-size:10px;letter-spacing:.12em;font-weight:600;box-shadow:0 0 0 5px #fff,0 0 0 7px ${esc(s.brandColor)}}
.seal span{font-size:24px;letter-spacing:0}
${st === 'revoked' || st === 'expired' ? '.cert .void{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:110px;font-weight:700;color:rgba(197,34,31,.13);letter-spacing:.1em}' : ''}
@media print{body{background:#fff}.bar{display:none}.wrap{padding:0}.cert{width:297mm;height:210mm;box-shadow:none;aspect-ratio:auto}}
</style></head><body>
<div class="bar"><div class="status">${banner[2]} · ID ${esc(cert.code)}</div><button onclick="print()">Print / Save as PDF</button></div>
<div class="wrap"><div class="cert">
${st === 'revoked' || st === 'expired' ? `<div class="void">${st.toUpperCase()}</div>` : ''}
<div class="org">${esc(s.orgName)}</div>
<h1>Certificate of Completion</h1>
<div class="sub">This is to certify that</div>
<div class="name">${esc(u.name)}</div>
<div class="txt">has successfully completed the course</div>
<div class="course">${esc(c.title)}</div>
${cert.score !== null && cert.score !== undefined ? `<div class="txt">with a final assessment score of <b>${esc(cert.score)}%</b></div>` : ''}
<div class="meta">
 <div style="text-align:left"><b>${fmt(cert.issuedAt)}</b>Date issued${cert.expiresAt ? `<br><br><b>${fmt(cert.expiresAt)}</b>Valid until` : ''}</div>
 <div class="seal"><span>✓</span>CERTIFIED</div>
 <div class="sig"><b>${esc(s.certSigner)}</b>${esc(s.certSignerTitle)}<br><span style="font-size:11px;color:#7a8594">Verify: ${esc(verifyUrl)}</span></div>
</div></div></div></body></html>`);
}

module.exports = { certHtml };
