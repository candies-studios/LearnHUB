'use strict';
// Tiny JSON-file datastore. Good for a few thousand employees; swap for Postgres/SQLite when you outgrow it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.LH_DATA || path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'db.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const defaults = {
  settings: {
    orgName: 'My Company',
    brandColor: '#0a6ed1',
    certSigner: 'Head of Learning & Development',
    certSignerTitle: 'Learning & Development',
    passwordMin: 8,
  },
  users: [],
  courses: [],
  exams: [],
  enrollments: [],
  attempts: [],
  certificates: [],
  audit: [],
};

for (const d of [DATA_DIR, path.join(CONTENT_DIR, 'uploads'), path.join(CONTENT_DIR, 'scorm'), BACKUP_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

let db = {};
if (fs.existsSync(FILE)) {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  // one backup per day, keeps the last 14
  const b = path.join(BACKUP_DIR, 'db-' + new Date().toISOString().slice(0, 10) + '.json');
  if (!fs.existsSync(b)) fs.copyFileSync(FILE, b);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort();
  while (old.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
}
for (const k of Object.keys(defaults)) if (db[k] === undefined) db[k] = JSON.parse(JSON.stringify(defaults[k]));
db.settings = { ...defaults.settings, ...db.settings };

let timer = null;
function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (!timer) timer = setTimeout(flush, 100);
}
function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}
function audit(userId, action, detail) {
  db.audit.push({ at: new Date().toISOString(), userId: userId || null, action, detail: detail || '' });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
  save();
}

process.on('exit', () => { if (timer) flush(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { if (timer) flush(); process.exit(0); });

module.exports = { db, save, flush, newId, audit, DATA_DIR, CONTENT_DIR };
