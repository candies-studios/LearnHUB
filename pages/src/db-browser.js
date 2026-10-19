// Browser replacement for lib/db.js: the whole database lives in this browser's localStorage.
const KEY = 'learnhub-demo-db-v1';
const defaults = {
  settings: { orgName: 'LearnHub Demo', brandColor: '#0a6ed1', certSigner: 'Head of Learning & Development', certSignerTitle: 'Learning & Development', passwordMin: 8 },
  users: [], courses: [], exams: [], enrollments: [], attempts: [], certificates: [], audit: [],
};
let db = {};
try { db = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { db = {}; }
for (const k of Object.keys(defaults)) if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(defaults[k]));
db.settings = { ...defaults.settings, ...db.settings };

let timer = null;
function flush() {
  clearTimeout(timer); timer = null;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('LearnHub: could not save', e); }
}
function save() { if (!timer) timer = setTimeout(flush, 50); }
function newId(prefix) {
  const a = new Uint8Array(5); crypto.getRandomValues(a);
  return prefix + '_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function audit(userId, action, detail) {
  db.audit.push({ at: new Date().toISOString(), userId: userId || null, action, detail: detail || '' });
  if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000);
  save();
}
function wipe() { localStorage.removeItem(KEY); }
window.addEventListener('pagehide', () => { if (timer) flush(); });
// another tab (e.g. a certificate tab) changed the data → reload ours lazily
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try { const fresh = JSON.parse(e.newValue); for (const k of Object.keys(fresh)) db[k] = fresh[k]; } catch (x) {}
});
module.exports = { db, save, flush, newId, audit, wipe, DATA_DIR: 'browser', CONTENT_DIR: 'browser' };
