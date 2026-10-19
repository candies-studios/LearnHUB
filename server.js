'use strict';
// LearnHub — self-hosted HR learning management platform. Zero npm dependencies: `node server.js`
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, save, newId, audit, CONTENT_DIR, DATA_DIR } = require('./lib/db');
const { parseMultipart } = require('./lib/multipart');
const { importScormFromZip, importScormFromFolder } = require('./lib/scorm');
const C = require('./lib/core');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.swf': 'application/x-shockwave-flash',
};

// ---------------------------------------------------------------- first run
{
  const created = C.ensureAdmin();
  if (created) console.log('\n  First run: created admin account  ' + created + '\n');
}

// ---------------------------------------------------------------- helpers
const { fail, toCsv, esc } = require('./lib/util');
const { registerRoutes, makeRouter, guard } = require('./lib/routes');
const { certHtml } = require('./lib/cert');

function send(res, status, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...(headers || {}) });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) {
  const b = await readBody(req, 10 * 1024 * 1024);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
}
async function multipart(req) {
  const b = await readBody(req, 2 * 1024 * 1024 * 1024);
  return parseMultipart(b, req.headers['content-type']);
}

// behind a hosting proxy (Render, Railway, Nginx…) the original scheme arrives in X-Forwarded-Proto
const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

// ---------------------------------------------------------------- sessions
const sessions = new Map(); // token -> { userId, exp }
const SESSION_MS = 12 * 3600 * 1000;
const failures = new Map(); // email -> { n, until }
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function currentUser(req) {
  const t = cookies(req).lh_sid;
  const s = t && sessions.get(t);
  if (!s || s.exp < Date.now()) return null;
  s.exp = Date.now() + SESSION_MS;
  const u = C.userById(s.userId);
  return u && u.active ? u : null;
}

// ---------------------------------------------------------------- routes (lib/routes.js) with the Node adapter
const router = makeRouter();
registerRoutes(router.route, {
  json, multipart, failures,
  startSession(req, res, u) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { userId: u.id, exp: Date.now() + SESSION_MS });
    send(res, 200, { user: C.pubUser(u) }, { 'Set-Cookie': `lh_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}` });
  },
  endSession(req, res) {
    const t = cookies(req).lh_sid;
    if (t) sessions.delete(t);
    send(res, 200, { ok: true }, { 'Set-Cookie': 'lh_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  },
  dropSessions(userId) { for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t); },
  async saveUpload(name, f) {
    fs.writeFileSync(path.join(CONTENT_DIR, 'uploads', name), f.data);
    return '/content/uploads/' + name;
  },
  async importScormZip(f) { return importScormFromZip(f.data); },
  async importScormFolder(p) { return importScormFromFolder(p); },
  csv(res, name, rows) {
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.end('\uFEFF' + toCsv(rows));
  },
});

// ================================================================= certificate page (public verification)
function certPage(req, res, code) {
  const found = db.certificates.some((c) => c.code === code);
  res.writeHead(found ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(certHtml(code, `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}/cert/`));
}

// ================================================================= static & content
function serveFile(req, res, root, rel, fallback) {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(path.resolve(root))) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (fallback) return serveFile(req, res, root, fallback);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (!m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(u.pathname);
    req.query = Object.fromEntries(u.searchParams);
    req.user = currentUser(req);
    if (p.startsWith('/api/')) {
      const hit = router.match(req.method, p);
      if (!hit) return send(res, 404, { error: 'Not found' });
      req.params = hit.params;
      const refused = guard(hit.route.role, req.user, p, req.method);
      if (refused) return send(res, refused[0], { error: refused[1] });
      const out = await hit.route.handler(req, res);
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return;
    }
    if (p.startsWith('/content/')) {
      if (!req.user) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Sign in required'); }
      return serveFile(req, res, CONTENT_DIR, p.slice('/content/'.length));
    }
    if (p.startsWith('/cert/')) return certPage(req, res, p.slice(6));
    return serveFile(req, res, PUB, p === '/' ? 'index.html' : p.slice(1), 'index.html');
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`  LearnHub is running →  http://localhost:${PORT}`);
    console.log(`  Data folder: ${DATA_DIR}`);
  });
}
module.exports = { server };
