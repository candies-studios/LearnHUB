// In-browser LearnHub API for the GitHub Pages demo.
// Runs the same route code as the Node server (lib/routes.js) against a localStorage database.
const { db, save, flush, wipe } = require('./db');
const C = require('./core');
const { registerRoutes, makeRouter, guard } = require('./routes');
const { createChillerCertification } = require('./chiller');
const { certHtml } = require('./cert');
const { toCsv, fail } = require('./util');

const SESSION_KEY = 'learnhub-demo-session';

// ---------- uploaded files (videos, PDFs) live in IndexedDB ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('learnhub-demo-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putBlob(id, blob) {
  const d = await idb();
  await new Promise((res, rej) => { const t = d.transaction('files', 'readwrite'); t.objectStore('files').put(blob, id); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function getBlob(id) {
  const d = await idb();
  return new Promise((res, rej) => { const q = d.transaction('files').objectStore('files').get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
const urlCache = {};
async function resolveUrl(url) {
  if (!url) return url;
  if (url.startsWith('idb:')) {
    if (urlCache[url]) return urlCache[url];
    const b = await getBlob(url.slice(4));
    return (urlCache[url] = b ? URL.createObjectURL(b) : '');
  }
  if (url.startsWith('/content/')) return url.slice(1); // bundled files, relative to the Pages site
  return url;
}

// ---------- first visit: demo data ----------
function seed() {
  if (db.users.length) return;
  const mk = (d) => C.createUser({ password: 'Welcome123!', mustChangePassword: false, ...d }).user;
  const admin = mk({ empId: 'ADM001', name: 'System Administrator', email: 'admin@company.local', password: 'Admin123!', role: 'admin', department: 'Human Resources', title: 'LMS Administrator', location: 'Pune' });
  const mgr = mk({ empId: 'E1001', name: 'Anita Rao', email: 'anita.rao@example.com', department: 'Facilities', title: 'Facilities Manager', location: 'Pune', role: 'manager', hireDate: '2019-06-03' });
  const people = [
    { empId: 'E1002', name: 'Rahul Verma', email: 'rahul.verma@example.com', title: 'HVAC Technician', location: 'Pune', hireDate: '2022-01-10' },
    { empId: 'E1003', name: 'Sneha Kulkarni', email: 'sneha.kulkarni@example.com', title: 'HVAC Technician', location: 'Pune', hireDate: '2023-03-15' },
    { empId: 'E1004', name: 'Imran Shaikh', email: 'imran.shaikh@example.com', title: 'Shift Engineer', location: 'Mumbai', hireDate: '2021-08-23' },
    { empId: 'E1005', name: 'Kavya Nair', email: 'kavya.nair@example.com', title: 'Maintenance Supervisor', location: 'Mumbai', hireDate: '2020-11-02' },
  ].map((p) => mk({ ...p, department: 'Facilities', role: 'employee', managerId: mgr.id }));
  mk({ empId: 'E2001', name: 'Deepak Joshi', email: 'deepak.joshi@example.com', department: 'Human Resources', title: 'HR Business Partner', location: 'Pune', role: 'employee', hireDate: '2018-02-12' });
  const scorm = {
    id: 'crs_chillerscorm', type: 'scorm', code: 'HVAC-SC-01', title: 'Chiller SOP and Lockout Process',
    description: 'Original SCORM package: Chiller SOP video, Lockout Process video and a 15-question final assessment (90% pass mark). Videos cannot be skipped.',
    category: 'HVAC & Facilities', color: '#5b3cc4', status: 'published', durationMins: 15, selfEnroll: true,
    certificate: { enabled: true, validityMonths: 12 }, modules: [], createdAt: C.now(),
    scorm: { dir: 'chiller', version: '1.2', items: [
      { id: 'item_video1', title: 'Module 1: Video – Chiller SOP', href: 'video1.html' },
      { id: 'item_video2', title: 'Module 2: Video – Lockout Process', href: 'video2.html' },
      { id: 'item_quiz', title: 'Module 3: Assessment', href: 'quiz.html' },
    ] },
  };
  db.courses.push(scorm);
  const native = createChillerCertification(scorm);
  const due = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  for (const u of [mgr, ...people]) C.enroll(u.id, native.id, { assignedBy: admin.id, dueDate: due, required: true });
  db.audit.length = 0;
  flush();
}

// ---------- the API ----------
const router = makeRouter();
const failures = new Map();
registerRoutes(router.route, {
  failures,
  json: async (req) => req.body || {},
  multipart: async (req) => {
    const fields = {}, files = [];
    for (const [k, v] of req.body.entries()) {
      if (typeof v === 'object' && v && 'size' in v) files.push({ field: k, filename: v.name, type: v.type, size: v.size, blob: v });
      else fields[k] = v;
    }
    return { fields, files };
  },
  startSession(req, res, u) { localStorage.setItem(SESSION_KEY, u.id); res.data = { user: C.pubUser(u) }; },
  endSession(req, res) { localStorage.removeItem(SESSION_KEY); res.data = { ok: true }; },
  dropSessions() {},
  async saveUpload(name, f) {
    if (f.size > 300 * 1048576) fail(413, 'Files over 300 MB are not supported in the browser demo');
    await putBlob('up_' + name, f.blob);
    return 'idb:up_' + name;
  },
  async importScormZip() { fail(400, 'SCORM import needs the server version of LearnHub. This demo comes with the Chiller SOP & Lockout package already installed.'); },
  async importScormFolder() { fail(400, 'SCORM import needs the server version of LearnHub.'); },
  csv(res, name, rows) { res.csv = { name, text: '﻿' + toCsv(rows) }; },
});

function sessionUser() {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    const u = id && C.userById(id);
    return u && u.active ? u : null;
  } catch (e) { return null; }
}

async function handle(method, url, body) {
  const u = new URL(url, location.href);
  const p = u.pathname.slice(u.pathname.indexOf('/api/'));
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const req = { method, body, query: Object.fromEntries(u.searchParams), user: sessionUser(), headers: { 'content-type': isForm ? 'multipart/form-data' : 'application/json' } };
  const hit = router.match(method, p);
  if (!hit) return { status: 404, data: { error: 'Not found' } };
  req.params = hit.params;
  const refused = guard(hit.route.role, req.user, p, method);
  if (refused) return { status: refused[0], data: { error: refused[1] } };
  const res = {};
  try {
    const out = await hit.route.handler(req, res);
    flush();
    if (res.csv) return { status: 200, csv: res.csv };
    const data = out !== undefined ? out : res.data;
    return { status: 200, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) };
  } catch (e) {
    if (!e.status) console.error(e);
    return { status: e.status || 500, data: { error: e.message || 'Error' } };
  }
}

function certificatePage(code) {
  const base = location.href.split('#')[0] + '#/cert/';
  return certHtml(code, base);
}

function reset() {
  wipe();
  localStorage.removeItem(SESSION_KEY);
  indexedDB.deleteDatabase('learnhub-demo-files');
}

seed();
module.exports = { handle, resolveUrl, certificatePage, reset };
