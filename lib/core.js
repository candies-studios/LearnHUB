'use strict';
// Business rules: passwords, enrollment progress, exam grading, certificates, reports.
const crypto = require('crypto');
const { db, save, newId, audit } = require('./db');

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

// ---------- passwords ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const calc = crypto.scryptSync(String(pw), salt, 64);
  const exp = Buffer.from(h, 'hex');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}
function tempPassword() {
  return 'Lh-' + crypto.randomBytes(4).toString('hex');
}

// ---------- lookups ----------
const userById = (id) => db.users.find((u) => u.id === id);
const courseById = (id) => db.courses.find((c) => c.id === id);
const examById = (id) => db.exams.find((e) => e.id === id);
const enrollmentById = (id) => db.enrollments.find((e) => e.id === id);
function pubUser(u) {
  if (!u) return null;
  const { passHash, ...rest } = u;
  return rest;
}
function teamOf(managerId) {
  return db.users.filter((u) => u.managerId === managerId);
}

// ---------- users ----------
function createUser(data, actorId) {
  const email = String(data.email || '').trim().toLowerCase();
  if (!email || !data.name) throw Object.assign(new Error('Name and email are required'), { status: 400 });
  if (db.users.some((u) => u.email === email)) throw Object.assign(new Error('Email already exists: ' + email), { status: 400 });
  if (data.empId && db.users.some((u) => u.empId && u.empId === data.empId)) throw Object.assign(new Error('Employee ID already exists: ' + data.empId), { status: 400 });
  const password = data.password || tempPassword();
  const u = {
    id: newId('usr'),
    empId: data.empId || '',
    name: String(data.name).trim(),
    email,
    role: ['admin', 'manager', 'employee'].includes(data.role) ? data.role : 'employee',
    department: data.department || '',
    title: data.title || '',
    location: data.location || '',
    managerId: data.managerId || '',
    hireDate: data.hireDate || '',
    active: data.active !== false,
    mustChangePassword: !data.password || !!data.mustChangePassword,
    passHash: hashPw(password),
    createdAt: now(),
  };
  db.users.push(u);
  audit(actorId, 'user.create', u.email);
  save();
  return { user: u, password };
}

function ensureAdmin() {
  if (db.users.length) return null;
  // On a hosted deployment set LH_ADMIN_EMAIL / LH_ADMIN_PASSWORD so the public site never has a known default password.
  const email = process.env.LH_ADMIN_EMAIL || 'admin@company.local';
  const password = process.env.LH_ADMIN_PASSWORD || 'ChangeMe123!';
  createUser({ name: 'System Administrator', email, role: 'admin', password, mustChangePassword: !process.env.LH_ADMIN_PASSWORD, empId: 'ADM001', department: 'Human Resources', title: 'LMS Administrator' });
  return email + (process.env.LH_ADMIN_PASSWORD ? ' (password from LH_ADMIN_PASSWORD)' : ' / ' + password);
}

// ---------- enrollment ----------
function scoStatus(d) {
  d = d || {};
  if (d['cmi.core.lesson_status']) return d['cmi.core.lesson_status'];
  if (d['cmi.success_status'] === 'passed' || d['cmi.success_status'] === 'failed') return d['cmi.success_status'];
  return d['cmi.completion_status'] || 'not attempted';
}

function enroll(userId, courseId, opts = {}) {
  const c = courseById(courseId);
  if (!c) throw Object.assign(new Error('Course not found'), { status: 404 });
  let e = db.enrollments.find((x) => x.userId === userId && x.courseId === courseId);
  if (e) {
    let changed = false;
    if (opts.reset && e.status === 'completed') {
      e.history = e.history || [];
      e.history.push({ completedAt: e.completedAt, score: e.score });
      Object.assign(e, { status: 'not_started', progress: {}, scorm: {}, score: null, completedAt: null, startedAt: null, extraAttempts: 0, cycle: (e.cycle || 1) + 1 });
      changed = true;
    }
    if (opts.dueDate !== undefined) { e.dueDate = opts.dueDate || ''; changed = true; }
    if (opts.required !== undefined) { e.required = !!opts.required; changed = true; }
    if (changed) save();
    return { enrollment: e, created: false, changed };
  }
  e = {
    id: newId('enr'),
    userId,
    courseId,
    assignedBy: opts.assignedBy || null,
    required: !!opts.required,
    dueDate: opts.dueDate || '',
    status: 'not_started',
    progress: {},
    scorm: {},
    score: null,
    progressPct: 0,
    enrolledAt: now(),
    startedAt: null,
    completedAt: null,
    extraAttempts: 0,
    cycle: 1,
  };
  db.enrollments.push(e);
  save();
  return { enrollment: e, created: true };
}

function examAttempts(e, moduleId) {
  return db.attempts.filter((a) => a.enrollmentId === e.id && a.moduleId === moduleId && a.submittedAt && (a.cycle || 1) === (e.cycle || 1));
}

function recompute(e) {
  const c = courseById(e.courseId);
  if (!c) return e;
  const prev = e.status;
  let total = 0, done = 0, failed = false, score = null;
  if (e.manualCompletion) {
    total = done = 1;
  } else if (c.type === 'scorm') {
    const items = (c.scorm && c.scorm.items) || [];
    total = items.length;
    for (const it of items) {
      const d = (e.scorm || {})[it.href] || {};
      const st = scoStatus(d);
      if (st === 'completed' || st === 'passed') done++;
      if (st === 'failed') failed = true;
      const raw = d['cmi.core.score.raw'] ?? d['cmi.score.raw'];
      const max = d['cmi.core.score.max'] ?? d['cmi.score.max'];
      const scaled = d['cmi.score.scaled'];
      if (raw !== undefined && raw !== '') score = max ? Math.round((Number(raw) / Number(max)) * 100) : Math.round(Number(raw));
      else if (scaled !== undefined && scaled !== '') score = Math.round(Number(scaled) * 100);
    }
    if (failed && done === total) failed = false;
  } else {
    total = c.modules.length;
    for (const m of c.modules) {
      if (m.type === 'exam') {
        const atts = examAttempts(e, m.id);
        const ex = examById(m.examId);
        if (atts.length) score = Math.max(...atts.map((a) => a.pct));
        if (atts.some((a) => a.passed)) done++;
        else if (ex && ex.maxAttempts && atts.length >= ex.maxAttempts + (e.extraAttempts || 0)) failed = true;
      } else if (e.progress && e.progress[m.id] && e.progress[m.id].done) done++;
    }
  }
  e.score = score;
  e.progressPct = total ? Math.round((done / total) * 100) : 0;
  if (total > 0 && done === total) {
    e.status = 'completed';
    if (!e.completedAt) e.completedAt = now();
    if (prev !== 'completed') onComplete(e, c);
  } else if (failed) e.status = 'failed';
  else if (done > 0 || e.startedAt) e.status = 'in_progress';
  else e.status = 'not_started';
  save();
  return e;
}

function addMonths(iso, n) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + Number(n));
  return d.toISOString();
}

function onComplete(e, c) {
  audit(e.userId, 'course.complete', c.title);
  if (c.certificate && c.certificate.enabled) issueCertificate(e, c);
}

function issueCertificate(e, c) {
  const code = 'LH-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const cert = {
    id: newId('crt'),
    code,
    userId: e.userId,
    courseId: c.id,
    enrollmentId: e.id,
    courseTitle: c.title,
    userName: (userById(e.userId) || {}).name || '',
    score: e.score,
    issuedAt: e.completedAt || now(),
    expiresAt: c.certificate.validityMonths ? addMonths(e.completedAt || now(), c.certificate.validityMonths) : null,
    revokedAt: null,
  };
  db.certificates.push(cert);
  audit(e.userId, 'certificate.issue', code + ' ' + c.title);
  save();
  return cert;
}

function certStatus(cert) {
  if (cert.revokedAt) return 'revoked';
  if (cert.expiresAt) {
    const t = Date.parse(cert.expiresAt);
    if (t < Date.now()) return 'expired';
    if (t < Date.now() + 30 * 864e5) return 'expiring';
  }
  return 'valid';
}
function certView(cert) {
  return { ...cert, status: certStatus(cert) };
}

function enrollmentView(e) {
  const c = courseById(e.courseId);
  const u = userById(e.userId);
  const certs = db.certificates.filter((x) => x.enrollmentId === e.id).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  return {
    ...e,
    scorm: undefined,
    overdue: !!(e.dueDate && e.status !== 'completed' && e.dueDate < today()),
    course: c ? { id: c.id, code: c.code, title: c.title, category: c.category, type: c.type, durationMins: c.durationMins, color: c.color } : null,
    user: u ? { id: u.id, name: u.name, email: u.email, empId: u.empId, department: u.department, title: u.title } : null,
    certificate: certs[0] ? certView(certs[0]) : null,
  };
}

// ---------- exams ----------
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizedAttempt(a) {
  return {
    id: a.id,
    examId: a.examId,
    enrollmentId: a.enrollmentId,
    moduleId: a.moduleId,
    title: a.title,
    startedAt: a.startedAt,
    deadline: a.deadline,
    submittedAt: a.submittedAt,
    answers: a.answers || {},
    questions: a.snapshot.map((q) => ({ id: q.id, type: q.type, text: q.text, points: q.points, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
  };
}

function startAttempt(user, e, moduleId) {
  const c = courseById(e.courseId);
  const m = c && c.modules.find((x) => x.id === moduleId && x.type === 'exam');
  if (!m) throw Object.assign(new Error('Exam not found in this course'), { status: 404 });
  const ex = examById(m.examId);
  if (!ex || !ex.questions.length) throw Object.assign(new Error('This exam has no questions yet'), { status: 400 });
  const open = db.attempts.find((a) => a.enrollmentId === e.id && a.moduleId === moduleId && !a.submittedAt);
  if (open) {
    if (!open.deadline || Date.parse(open.deadline) + 60000 > Date.now()) return open;
    submitAttempt(open, open.answers || {}, true); // expired: auto-grade
  }
  const atts = examAttempts(e, moduleId);
  if (atts.some((a) => a.passed)) throw Object.assign(new Error('You have already passed this exam'), { status: 400 });
  const allowed = ex.maxAttempts ? ex.maxAttempts + (e.extraAttempts || 0) : Infinity;
  if (atts.length >= allowed) throw Object.assign(new Error('No attempts left. Ask your administrator for another attempt.'), { status: 400 });
  let qs = ex.shuffleQuestions ? shuffle(ex.questions) : ex.questions.slice();
  if (ex.drawCount && ex.drawCount < qs.length) qs = (ex.shuffleQuestions ? qs : shuffle(qs)).slice(0, ex.drawCount);
  const snapshot = qs.map((q) => ({
    id: q.id,
    type: q.type,
    text: q.text,
    points: Number(q.points) || 1,
    explanation: q.explanation || '',
    options: (ex.shuffleOptions && q.type !== 'tf' ? shuffle(q.options) : q.options).map((o) => ({ id: o.id, text: o.text, correct: !!o.correct })),
  }));
  const startedAt = now();
  const a = {
    id: newId('att'),
    userId: user.id,
    examId: ex.id,
    courseId: c.id,
    enrollmentId: e.id,
    moduleId,
    cycle: e.cycle || 1,
    title: ex.title,
    passPct: ex.passPct,
    attemptNo: atts.length + 1,
    startedAt,
    deadline: ex.timeLimitMins ? new Date(Date.now() + ex.timeLimitMins * 60000).toISOString() : null,
    submittedAt: null,
    answers: {},
    snapshot,
  };
  db.attempts.push(a);
  if (!e.startedAt) e.startedAt = startedAt;
  recompute(e);
  save();
  return a;
}

function submitAttempt(a, answers, auto) {
  if (a.submittedAt) return a;
  let score = 0, max = 0;
  const results = {};
  for (const q of a.snapshot) {
    max += q.points;
    const given = [].concat(answers[q.id] || []).map(String);
    const correct = q.options.filter((o) => o.correct).map((o) => o.id);
    const ok = given.length === correct.length && correct.every((id) => given.includes(id));
    if (ok) score += q.points;
    results[q.id] = ok;
  }
  a.answers = answers;
  a.results = results;
  a.score = score;
  a.maxScore = max;
  a.pct = max ? Math.round((score / max) * 100) : 0;
  a.passed = a.pct >= (a.passPct || 0);
  a.submittedAt = now();
  a.autoSubmitted = !!auto || (a.deadline && Date.parse(a.deadline) + 60000 < Date.now());
  a.durationSec = Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 1000);
  audit(a.userId, 'exam.submit', `${a.title}: ${a.pct}% ${a.passed ? 'PASS' : 'FAIL'}`);
  const e = enrollmentById(a.enrollmentId);
  if (e) recompute(e);
  save();
  return a;
}

function attemptView(a, withAnswers) {
  const u = userById(a.userId);
  const c = courseById(a.courseId);
  const base = {
    id: a.id, title: a.title, attemptNo: a.attemptNo, startedAt: a.startedAt, submittedAt: a.submittedAt,
    score: a.score, maxScore: a.maxScore, pct: a.pct, passed: a.passed, passPct: a.passPct, durationSec: a.durationSec,
    autoSubmitted: a.autoSubmitted, enrollmentId: a.enrollmentId, courseId: a.courseId,
    courseTitle: c ? c.title : '', user: u ? { id: u.id, name: u.name, empId: u.empId, department: u.department } : null,
    questionCount: a.snapshot.length,
  };
  if (!a.submittedAt) return base;
  base.review = a.snapshot.map((q) => ({
    id: q.id, text: q.text, type: q.type, ok: a.results ? a.results[q.id] : null,
    ...(withAnswers ? { explanation: q.explanation, options: q.options, given: [].concat(a.answers[q.id] || []) } : {}),
  }));
  return base;
}

// ---------- reports ----------
function report(userFilter) {
  const users = db.users.filter((u) => u.active && (!userFilter || userFilter(u)));
  const ids = new Set(users.map((u) => u.id));
  const enrs = db.enrollments.filter((e) => ids.has(e.userId));
  const t = today();
  const isOver = (e) => e.dueDate && e.status !== 'completed' && e.dueDate < t;
  const completed = enrs.filter((e) => e.status === 'completed');
  const atts = db.attempts.filter((a) => a.submittedAt && ids.has(a.userId));
  const certs = db.certificates.filter((c) => ids.has(c.userId)).map(certView);
  const byCourse = db.courses.filter((c) => c.status !== 'archived').map((c) => {
    const ce = enrs.filter((e) => e.courseId === c.id);
    const sc = ce.filter((e) => e.score !== null && e.score !== undefined);
    return {
      id: c.id, title: c.title, code: c.code, type: c.type, enrolled: ce.length,
      completed: ce.filter((e) => e.status === 'completed').length,
      inProgress: ce.filter((e) => e.status === 'in_progress').length,
      failed: ce.filter((e) => e.status === 'failed').length,
      overdue: ce.filter(isOver).length,
      avgScore: sc.length ? Math.round(sc.reduce((s, e) => s + e.score, 0) / sc.length) : null,
    };
  });
  const depts = [...new Set(users.map((u) => u.department || 'Unassigned'))].sort();
  const byDept = depts.map((d) => {
    const du = new Set(users.filter((u) => (u.department || 'Unassigned') === d).map((u) => u.id));
    const de = enrs.filter((e) => du.has(e.userId));
    return { department: d, employees: du.size, enrolled: de.length, completed: de.filter((e) => e.status === 'completed').length, overdue: de.filter(isOver).length };
  });
  return {
    kpis: {
      employees: users.length,
      courses: db.courses.filter((c) => c.status === 'published').length,
      enrollments: enrs.length,
      completed: completed.length,
      completionRate: enrs.length ? Math.round((completed.length / enrs.length) * 100) : 0,
      overdue: enrs.filter(isOver).length,
      certificatesValid: certs.filter((c) => c.status === 'valid' || c.status === 'expiring').length,
      certificatesExpiring: certs.filter((c) => c.status === 'expiring').length,
      certificatesExpired: certs.filter((c) => c.status === 'expired').length,
      attempts: atts.length,
      passRate: atts.length ? Math.round((atts.filter((a) => a.passed).length / atts.length) * 100) : 0,
      avgScore: atts.length ? Math.round(atts.reduce((s, a) => s + a.pct, 0) / atts.length) : 0,
    },
    byCourse,
    byDept,
    overdue: enrs.filter(isOver).map(enrollmentView).slice(0, 50),
    expiring: certs.filter((c) => c.status === 'expiring' || c.status === 'expired').slice(0, 50),
    recentAttempts: atts.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)).slice(0, 10).map((a) => attemptView(a, false)),
  };
}

module.exports = {
  ensureAdmin, now, today, hashPw, checkPw, tempPassword, userById, courseById, examById, enrollmentById, pubUser, teamOf,
  createUser, enroll, recompute, scoStatus, enrollmentView, startAttempt, submitAttempt, sanitizedAttempt,
  attemptView, examAttempts, certView, certStatus, issueCertificate, report,
};
