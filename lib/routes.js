'use strict';
// All LearnHub API routes. Shared by the Node server (server.js) and the in-browser
// GitHub Pages demo (pages/lh-local.js), which supply their own `env` adapter for
// sessions, request bodies, uploads, SCORM import and CSV downloads.
const { db, save, newId, audit } = require('./db');
const C = require('./core');
const { createChillerCertification } = require('./chiller');
const { fail, parseCsv, toCsv, safeName } = require('./util');

const isAdmin = (u) => u.role === 'admin';
const canManage = (actor, userId) => isAdmin(actor) || (actor.role === 'manager' && (C.userById(userId) || {}).managerId === actor.id);

// Who may call a route; returns [status, message] when refused.
function guard(role, user, path, method) {
  if (role === 'public') return null;
  if (!user) return [401, 'Please sign in'];
  if (user.mustChangePassword && path !== '/api/me/password' && method !== 'GET') return [403, 'Please change your password first'];
  if (role === 'admin' && user.role !== 'admin') return [403, 'Administrators only'];
  if (role === 'manager' && !['admin', 'manager'].includes(user.role)) return [403, 'Managers only'];
  return null;
}

function makeRouter() {
  const routes = [];
  const route = (method, pattern, role, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, role, handler });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return null;
  };
  return { routes, route, match };
}

function registerRoutes(route, env) {
  const { json, multipart, failures } = env;

  // ================================================================= AUTH
  route('POST', '/api/login', 'public', async (req, res) => {
    const { email, password } = await json(req);
    const key = String(email || '').trim().toLowerCase();
    const f = failures.get(key);
    if (f && f.until > Date.now()) fail(429, 'Too many failed attempts. Try again in a few minutes.');
    const u = db.users.find((x) => x.email === key);
    if (!u || !C.checkPw(password || '', u.passHash)) {
      const n = (f && f.until < Date.now() ? 0 : f ? f.n : 0) + 1;
      failures.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
      fail(401, 'Incorrect email or password');
    }
    if (!u.active) fail(403, 'This account is deactivated. Contact HR.');
    failures.delete(key);
    u.lastLoginAt = C.now();
    audit(u.id, 'auth.login', u.email);
    return env.startSession(req, res, u);
  });
  route('POST', '/api/logout', 'public', async (req, res) => env.endSession(req, res));
  route('GET', '/api/me', 'public', async (req) => ({
    user: req.user ? C.pubUser(req.user) : null,
    settings: db.settings,
    teamSize: req.user ? C.teamOf(req.user.id).length : 0,
  }));
  route('POST', '/api/me/password', 'user', async (req) => {
    const { current, next } = await json(req);
    if (!C.checkPw(current || '', req.user.passHash)) fail(400, 'Current password is incorrect');
    if (!next || next.length < db.settings.passwordMin) fail(400, `New password must be at least ${db.settings.passwordMin} characters`);
    if (next === current) fail(400, 'New password must be different');
    req.user.passHash = C.hashPw(next);
    req.user.mustChangePassword = false;
    audit(req.user.id, 'auth.password_change', '');
    save();
    return { ok: true };
  });

  // ================================================================= LEARNER
  route('GET', '/api/my/enrollments', 'user', async (req) =>
    db.enrollments.filter((e) => e.userId === req.user.id).map(C.enrollmentView).filter((e) => e.course));

  route('GET', '/api/catalog', 'user', async (req) => {
    const mine = Object.fromEntries(db.enrollments.filter((e) => e.userId === req.user.id).map((e) => [e.courseId, e]));
    return db.courses.filter((c) => c.status === 'published').map((c) => ({
      id: c.id, code: c.code, title: c.title, description: c.description, category: c.category, type: c.type,
      durationMins: c.durationMins, color: c.color, selfEnroll: c.selfEnroll !== false,
      moduleCount: c.type === 'scorm' ? c.scorm.items.length : c.modules.length,
      certificate: !!(c.certificate && c.certificate.enabled),
      enrollment: mine[c.id] ? { id: mine[c.id].id, status: mine[c.id].status, progressPct: mine[c.id].progressPct } : null,
    }));
  });
  route('POST', '/api/catalog/:id/enroll', 'user', async (req) => {
    const c = C.courseById(req.params.id);
    if (!c || (c.status !== 'published' && !isAdmin(req.user))) fail(404, 'Course not available');
    if (c.selfEnroll === false && !isAdmin(req.user) && !db.enrollments.some((e) => e.userId === req.user.id && e.courseId === c.id)) fail(403, 'This course is assignment-only');
    const { enrollment, created } = C.enroll(req.user.id, c.id, { assignedBy: req.user.id });
    if (created) audit(req.user.id, 'course.self_enroll', c.title);
    return { id: enrollment.id };
  });

  function myEnrollment(req, id) {
    const e = C.enrollmentById(id);
    if (!e || e.userId !== req.user.id) fail(404, 'Enrollment not found');
    return e;
  }

  route('GET', '/api/learn/:id', 'user', async (req) => {
    const e = myEnrollment(req, req.params.id);
    const c = C.courseById(e.courseId);
    if (!c) fail(404, 'Course removed');
    const modules = (c.modules || []).map((m) => {
      const out = { ...m, done: !!(e.progress[m.id] && e.progress[m.id].done) };
      if (m.type === 'exam') {
        const ex = C.examById(m.examId) || { questions: [] };
        const atts = C.examAttempts(e, m.id);
        const open = db.attempts.find((a) => a.enrollmentId === e.id && a.moduleId === m.id && !a.submittedAt);
        out.exam = {
          title: ex.title, questionCount: ex.drawCount && ex.drawCount < ex.questions.length ? ex.drawCount : ex.questions.length,
          passPct: ex.passPct, timeLimitMins: ex.timeLimitMins, maxAttempts: ex.maxAttempts ? ex.maxAttempts + (e.extraAttempts || 0) : 0,
          instructions: ex.instructions || '',
          attempts: atts.map((a) => ({ id: a.id, attemptNo: a.attemptNo, pct: a.pct, passed: a.passed, submittedAt: a.submittedAt })),
          openAttemptId: open ? open.id : null,
        };
        out.done = atts.some((a) => a.passed);
      }
      return out;
    });
    return {
      enrollment: C.enrollmentView(e),
      scormData: e.scorm || {},
      course: { id: c.id, code: c.code, title: c.title, description: c.description, type: c.type, scorm: c.scorm, modules, certificate: c.certificate, sequential: !!c.sequential },
      learner: { id: req.user.id, name: req.user.name, empId: req.user.empId },
    };
  });
  route('POST', '/api/learn/:id/start', 'user', async (req) => {
    const e = myEnrollment(req, req.params.id);
    if (!e.startedAt) { e.startedAt = C.now(); C.recompute(e); }
    return { ok: true };
  });
  route('POST', '/api/learn/:id/modules/:mid/complete', 'user', async (req) => {
    const e = myEnrollment(req, req.params.id);
    const c = C.courseById(e.courseId);
    const m = c.modules.find((x) => x.id === req.params.mid);
    if (!m || m.type === 'exam') fail(400, 'Invalid module');
    e.progress[m.id] = { done: true, at: C.now() };
    if (!e.startedAt) e.startedAt = C.now();
    C.recompute(e);
    return C.enrollmentView(e);
  });
  route('POST', '/api/scorm/:id/commit', 'user', async (req) => {
    const e = myEnrollment(req, req.params.id);
    const { sco, cmi } = await json(req);
    if (!sco || typeof cmi !== 'object') fail(400, 'Bad SCORM payload');
    e.scorm = e.scorm || {};
    const prev = e.scorm[sco] || {};
    // never downgrade a finished SCO back to incomplete
    const keep = ['completed', 'passed'];
    const merged = { ...prev, ...cmi };
    if (keep.includes(prev['cmi.core.lesson_status']) && !['passed', 'failed', 'completed'].includes(cmi['cmi.core.lesson_status'])) merged['cmi.core.lesson_status'] = prev['cmi.core.lesson_status'];
    if (prev['cmi.completion_status'] === 'completed') merged['cmi.completion_status'] = 'completed';
    e.scorm[sco] = merged;
    if (!e.startedAt) e.startedAt = C.now();
    C.recompute(e);
    return { enrollment: C.enrollmentView(e), scormData: e.scorm };
  });

  // ---- exams
  route('POST', '/api/exam/start', 'user', async (req) => {
    const { enrollmentId, moduleId } = await json(req);
    const e = myEnrollment(req, enrollmentId);
    return C.sanitizedAttempt(C.startAttempt(req.user, e, moduleId));
  });
  function myAttempt(req, id) {
    const a = db.attempts.find((x) => x.id === id);
    if (!a) fail(404, 'Attempt not found');
    if (a.userId !== req.user.id && !canManage(req.user, a.userId)) fail(403, 'Not allowed');
    return a;
  }
  route('GET', '/api/exam/:id', 'user', async (req) => {
    const a = myAttempt(req, req.params.id);
    if (a.userId !== req.user.id) fail(403, 'Not allowed');
    return C.sanitizedAttempt(a);
  });
  route('POST', '/api/exam/:id/save', 'user', async (req) => {
    const a = myAttempt(req, req.params.id);
    if (a.userId !== req.user.id || a.submittedAt) fail(400, 'Attempt is closed');
    const { answers } = await json(req);
    a.answers = answers || {};
    save();
    return { ok: true };
  });
  route('POST', '/api/exam/:id/submit', 'user', async (req) => {
    const a = myAttempt(req, req.params.id);
    if (a.userId !== req.user.id) fail(403, 'Not allowed');
    const { answers } = await json(req);
    C.submitAttempt(a, answers || a.answers || {});
    return { id: a.id };
  });
  route('GET', '/api/attempts/:id', 'user', async (req) => {
    const a = myAttempt(req, req.params.id);
    const ex = C.examById(a.examId) || {};
    const own = a.userId === req.user.id;
    const withAnswers = !own || ex.reviewAnswers === 'always' || (ex.reviewAnswers === 'after_pass' && a.passed);
    const v = C.attemptView(a, withAnswers);
    const cert = db.certificates.find((c) => c.enrollmentId === a.enrollmentId && !c.revokedAt);
    v.certificateCode = a.passed && cert ? cert.code : null;
    v.reviewMode = withAnswers ? 'full' : 'summary';
    return v;
  });

  route('GET', '/api/my/certificates', 'user', async (req) =>
    db.certificates.filter((c) => c.userId === req.user.id).map(C.certView).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)));
  route('GET', '/api/my/transcript', 'user', async (req) => ({
    enrollments: db.enrollments.filter((e) => e.userId === req.user.id).map(C.enrollmentView).filter((e) => e.course),
    attempts: db.attempts.filter((a) => a.userId === req.user.id && a.submittedAt).map((a) => C.attemptView(a, false)).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)),
  }));

  // ================================================================= MANAGER
  route('GET', '/api/team', 'manager', async (req) => {
    const team = isAdmin(req.user) && req.query.all ? db.users : C.teamOf(req.user.id);
    return team.map((u) => ({
      ...C.pubUser(u),
      enrollments: db.enrollments.filter((e) => e.userId === u.id).map(C.enrollmentView).filter((e) => e.course),
    }));
  });
  route('GET', '/api/team/report', 'manager', async (req) => C.report((u) => u.managerId === req.user.id));

  route('POST', '/api/assign', 'manager', async (req) => {
    const { courseId, userIds = [], departments = [], dueDate = '', required = true, reset = false } = await json(req);
    const c = C.courseById(courseId);
    if (!c) fail(404, 'Course not found');
    if (c.status !== 'published') fail(400, 'Publish the course before assigning it');
    const targets = new Set(userIds);
    if (departments.length) db.users.filter((u) => u.active && departments.includes(u.department)).forEach((u) => targets.add(u.id));
    let created = 0, updated = 0, skipped = 0;
    for (const uid of targets) {
      if (!C.userById(uid) || !canManage(req.user, uid)) { skipped++; continue; }
      const r = C.enroll(uid, courseId, { assignedBy: req.user.id, dueDate, required, reset });
      if (r.created) created++; else if (r.changed) updated++;
    }
    audit(req.user.id, 'course.assign', `${c.title} → ${created} new, ${updated} updated`);
    return { created, updated, skipped };
  });

  // ================================================================= ADMIN: people
  route('GET', '/api/admin/users', 'admin', async () => db.users.map((u) => {
    const enrs = db.enrollments.filter((e) => e.userId === u.id);
    return { ...C.pubUser(u), stats: { enrolled: enrs.length, completed: enrs.filter((e) => e.status === 'completed').length, overdue: enrs.filter((e) => e.dueDate && e.status !== 'completed' && e.dueDate < C.today()).length } };
  }));
  route('POST', '/api/admin/users', 'admin', async (req) => {
    const body = await json(req);
    const { user, password } = C.createUser(body, req.user.id);
    return { user: C.pubUser(user), tempPassword: body.password ? null : password };
  });
  route('PUT', '/api/admin/users/:id', 'admin', async (req) => {
    const u = C.userById(req.params.id);
    if (!u) fail(404, 'User not found');
    const b = await json(req);
    if (b.email) {
      const em = String(b.email).trim().toLowerCase();
      if (db.users.some((x) => x.email === em && x.id !== u.id)) fail(400, 'Email already in use');
      u.email = em;
    }
    if (b.empId !== undefined && b.empId && db.users.some((x) => x.empId === b.empId && x.id !== u.id)) fail(400, 'Employee ID already in use');
    for (const k of ['name', 'empId', 'department', 'title', 'location', 'managerId', 'hireDate']) if (b[k] !== undefined) u[k] = b[k];
    if (b.role && ['admin', 'manager', 'employee'].includes(b.role)) {
      if (u.id === req.user.id && b.role !== 'admin') fail(400, "You can't remove your own admin role");
      u.role = b.role;
    }
    if (b.active !== undefined) {
      if (u.id === req.user.id && !b.active) fail(400, "You can't deactivate yourself");
      u.active = !!b.active;
      if (!u.active) env.dropSessions(u.id);
    }
    audit(req.user.id, 'user.update', u.email);
    save();
    return C.pubUser(u);
  });
  route('POST', '/api/admin/users/:id/reset-password', 'admin', async (req) => {
    const u = C.userById(req.params.id);
    if (!u) fail(404, 'User not found');
    const pw = C.tempPassword();
    u.passHash = C.hashPw(pw);
    u.mustChangePassword = true;
    audit(req.user.id, 'user.reset_password', u.email);
    save();
    return { tempPassword: pw };
  });
  route('POST', '/api/admin/users/import', 'admin', async (req) => {
    const { csv } = await json(req);
    const rows = parseCsv(csv || '');
    if (rows.length < 2) fail(400, 'CSV needs a header row and at least one employee');
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ''));
    const col = (r, ...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return (r[i] || '').trim(); } return ''; };
    const created = [], updated = [], errors = [];
    const pending = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const email = col(r, 'email', 'emailaddress').toLowerCase();
      const rec = { empId: col(r, 'empid', 'employeeid', 'id'), name: col(r, 'name', 'fullname'), email, department: col(r, 'department', 'dept'), title: col(r, 'title', 'jobtitle', 'position'), location: col(r, 'location', 'site'), role: col(r, 'role').toLowerCase() || undefined, hireDate: col(r, 'hiredate', 'startdate'), managerEmail: col(r, 'manageremail', 'manager').toLowerCase() };
      try {
        const ex = db.users.find((u) => u.email === email);
        if (ex) {
          for (const k of ['empId', 'name', 'department', 'title', 'location', 'hireDate']) if (rec[k]) ex[k] = rec[k];
          if (rec.role && ['admin', 'manager', 'employee'].includes(rec.role) && ex.id !== req.user.id) ex.role = rec.role;
          updated.push(email);
          pending.push([ex, rec.managerEmail]);
        } else {
          const { user, password } = C.createUser(rec, req.user.id);
          created.push({ name: user.name, email: user.email, tempPassword: password });
          pending.push([user, rec.managerEmail]);
        }
      } catch (e) { errors.push(`Row ${i + 1}: ${e.message}`); }
    }
    for (const [u, me] of pending) {
      if (!me) continue;
      const m = db.users.find((x) => x.email === me);
      if (m) { u.managerId = m.id; if (m.role === 'employee') m.role = 'manager'; } else errors.push(`${u.email}: manager ${me} not found`);
    }
    audit(req.user.id, 'user.import', `${created.length} created, ${updated.length} updated`);
    save();
    return { created, updated: updated.length, errors };
  });
  route('GET', '/api/admin/users/:id/learning', 'manager', async (req) => {
    if (!canManage(req.user, req.params.id)) fail(403, 'Not allowed');
    return {
      user: C.pubUser(C.userById(req.params.id)),
      enrollments: db.enrollments.filter((e) => e.userId === req.params.id).map(C.enrollmentView).filter((e) => e.course),
      attempts: db.attempts.filter((a) => a.userId === req.params.id && a.submittedAt).map((a) => C.attemptView(a, false)),
    };
  });

  // ================================================================= ADMIN: enrollments
  route('GET', '/api/admin/enrollments', 'manager', async (req) => {
    const { courseId, status, department } = req.query;
    return db.enrollments
      .filter((e) => canManage(req.user, e.userId))
      .filter((e) => !courseId || e.courseId === courseId)
      .map(C.enrollmentView)
      .filter((e) => e.course && e.user)
      .filter((e) => !status || (status === 'overdue' ? e.overdue : e.status === status))
      .filter((e) => !department || e.user.department === department);
  });
  function managedEnrollment(req) {
    const e = C.enrollmentById(req.params.id);
    if (!e) fail(404, 'Enrollment not found');
    if (!canManage(req.user, e.userId)) fail(403, 'Not allowed');
    return e;
  }
  route('POST', '/api/admin/enrollments/:id/extra-attempt', 'manager', async (req) => {
    const e = managedEnrollment(req);
    e.extraAttempts = (e.extraAttempts || 0) + 1;
    C.recompute(e);
    audit(req.user.id, 'enrollment.extra_attempt', e.id);
    return C.enrollmentView(e);
  });
  route('POST', '/api/admin/enrollments/:id/complete', 'admin', async (req) => {
    const e = managedEnrollment(req);
    const { note } = await json(req);
    e.manualCompletion = { by: req.user.id, at: C.now(), note: note || '' };
    C.recompute(e);
    audit(req.user.id, 'enrollment.manual_complete', `${e.id} ${note || ''}`);
    return C.enrollmentView(e);
  });
  route('POST', '/api/admin/enrollments/:id/due', 'manager', async (req) => {
    const e = managedEnrollment(req);
    const { dueDate } = await json(req);
    e.dueDate = dueDate || '';
    save();
    return C.enrollmentView(e);
  });
  route('DELETE', '/api/admin/enrollments/:id', 'admin', async (req) => {
    const e = managedEnrollment(req);
    db.enrollments.splice(db.enrollments.indexOf(e), 1);
    audit(req.user.id, 'enrollment.delete', e.id);
    save();
    return { ok: true };
  });

  // ================================================================= ADMIN: courses & content
  function courseStats(c) {
    const ce = db.enrollments.filter((e) => e.courseId === c.id);
    return { enrolled: ce.length, completed: ce.filter((e) => e.status === 'completed').length };
  }
  route('GET', '/api/admin/courses', 'manager', async () => db.courses.map((c) => ({ ...c, stats: courseStats(c) })));
  route('GET', '/api/admin/courses/:id', 'admin', async (req) => {
    const c = C.courseById(req.params.id);
    if (!c) fail(404, 'Course not found');
    return { ...c, stats: courseStats(c) };
  });
  function normalizeCourse(b, c) {
    for (const k of ['code', 'title', 'description', 'category', 'color', 'status']) if (b[k] !== undefined) c[k] = String(b[k]);
    if (b.durationMins !== undefined) c.durationMins = Number(b.durationMins) || 0;
    if (b.selfEnroll !== undefined) c.selfEnroll = !!b.selfEnroll;
    if (b.sequential !== undefined) c.sequential = !!b.sequential;
    if (b.certificate) c.certificate = { enabled: !!b.certificate.enabled, validityMonths: Number(b.certificate.validityMonths) || 0 };
    if (Array.isArray(b.modules) && c.type !== 'scorm') {
      c.modules = b.modules.map((m) => ({
        id: m.id || newId('mod'), type: m.type, title: String(m.title || 'Untitled'),
        ...(m.type === 'video' ? { url: m.url || '', preventSkip: !!m.preventSkip } : {}),
        ...(m.type === 'document' ? { url: m.url || '', fileName: m.fileName || '' } : {}),
        ...(m.type === 'text' ? { body: m.body || '' } : {}),
        ...(m.type === 'link' ? { url: m.url || '' } : {}),
        ...(m.type === 'exam' ? { examId: m.examId } : {}),
      }));
    }
    if (!c.title) fail(400, 'Course title is required');
    return c;
  }
  route('POST', '/api/admin/courses', 'admin', async (req) => {
    const b = await json(req);
    const c = normalizeCourse(b, {
      id: newId('crs'), type: 'native', code: '', title: '', description: '', category: 'General', color: '#0a6ed1', status: 'draft',
      durationMins: 30, selfEnroll: true, sequential: false, certificate: { enabled: true, validityMonths: 12 }, modules: [], createdAt: C.now(),
    });
    db.courses.push(c);
    audit(req.user.id, 'course.create', c.title);
    save();
    return c;
  });
  route('PUT', '/api/admin/courses/:id', 'admin', async (req) => {
    const c = C.courseById(req.params.id);
    if (!c) fail(404, 'Course not found');
    normalizeCourse(await json(req), c);
    c.updatedAt = C.now();
    // progress may change if modules were added/removed
    db.enrollments.filter((e) => e.courseId === c.id && e.status !== 'completed').forEach(C.recompute);
    audit(req.user.id, 'course.update', c.title);
    save();
    return c;
  });
  route('DELETE', '/api/admin/courses/:id', 'admin', async (req) => {
    const c = C.courseById(req.params.id);
    if (!c) fail(404, 'Course not found');
    if (db.enrollments.some((e) => e.courseId === c.id)) {
      c.status = 'archived';
      audit(req.user.id, 'course.archive', c.title);
    } else {
      db.courses.splice(db.courses.indexOf(c), 1);
      audit(req.user.id, 'course.delete', c.title);
    }
    save();
    return { ok: true, archived: c.status === 'archived' };
  });
  route('POST', '/api/admin/upload', 'admin', async (req) => {
    const { files } = await multipart(req);
    if (!files.length) fail(400, 'No file received');
    const f = files[0];
    const name = Date.now().toString(36) + '-' + safeName(f.filename);
    const url = await env.saveUpload(name, f);
    audit(req.user.id, 'content.upload', f.filename);
    return { url, fileName: f.filename, size: f.size != null ? f.size : f.data.length };
  });
  route('POST', '/api/admin/scorm', 'admin', async (req) => {
    let pkg;
    if ((req.headers['content-type'] || '').includes('multipart')) {
      const { files } = await multipart(req);
      if (!files.length) fail(400, 'No file received');
      pkg = await env.importScormZip(files[0]);
    } else {
      const { folderPath } = await json(req);
      if (!folderPath) fail(400, 'folderPath required');
      pkg = await env.importScormFolder(folderPath);
    }
    const c = {
      id: newId('crs'), type: 'scorm', code: '', title: pkg.title, description: 'Imported SCORM ' + pkg.version + ' package.',
      category: 'General', color: '#5b3cc4', status: 'published', durationMins: 30, selfEnroll: true,
      certificate: { enabled: true, validityMonths: 12 }, modules: [], scorm: { dir: pkg.dir, version: pkg.version, items: pkg.items }, createdAt: C.now(),
    };
    db.courses.push(c);
    audit(req.user.id, 'course.scorm_import', c.title);
    // Uploading the Chiller & Lockout package also builds the native certification course from it (once).
    const extra = createChillerCertification(c);
    if (extra) audit(req.user.id, 'course.create', extra.title);
    save();
    return { ...c, alsoCreated: extra ? extra.title : null };
  });

  // ---- exams (question banks)
  route('GET', '/api/admin/exams/:id', 'admin', async (req) => {
    const ex = C.examById(req.params.id);
    if (!ex) fail(404, 'Exam not found');
    return ex;
  });
  function normalizeExam(b, ex) {
    for (const k of ['title', 'instructions']) if (b[k] !== undefined) ex[k] = String(b[k]);
    for (const k of ['passPct', 'timeLimitMins', 'maxAttempts', 'drawCount']) if (b[k] !== undefined) ex[k] = Math.max(0, Number(b[k]) || 0);
    for (const k of ['shuffleQuestions', 'shuffleOptions']) if (b[k] !== undefined) ex[k] = !!b[k];
    if (b.reviewAnswers !== undefined) ex.reviewAnswers = ['never', 'always', 'after_pass'].includes(b.reviewAnswers) ? b.reviewAnswers : 'always';
    if (Array.isArray(b.questions)) {
      ex.questions = b.questions.map((q, i) => {
        const type = ['single', 'multi', 'tf'].includes(q.type) ? q.type : 'single';
        const options = (q.options || []).filter((o) => String(o.text || '').trim()).map((o) => ({ id: o.id || newId('opt'), text: String(o.text).trim(), correct: !!o.correct }));
        if (!String(q.text || '').trim()) fail(400, `Question ${i + 1} has no text`);
        if (options.length < 2) fail(400, `Question ${i + 1} needs at least two options`);
        const nCorrect = options.filter((o) => o.correct).length;
        if (!nCorrect) fail(400, `Question ${i + 1} has no correct answer marked`);
        if (type !== 'multi' && nCorrect > 1) fail(400, `Question ${i + 1} is single-answer but has ${nCorrect} correct options`);
        return { id: q.id || newId('q'), type, text: String(q.text).trim(), explanation: q.explanation || '', points: Number(q.points) || 1, options };
      });
    }
    if (ex.passPct > 100) ex.passPct = 100;
    return ex;
  }
  route('POST', '/api/admin/exams', 'admin', async (req) => {
    const ex = normalizeExam(await json(req), {
      id: newId('exm'), title: 'Assessment', instructions: '', passPct: 80, timeLimitMins: 0, maxAttempts: 3, drawCount: 0,
      shuffleQuestions: true, shuffleOptions: true, reviewAnswers: 'always', questions: [], createdAt: C.now(),
    });
    db.exams.push(ex);
    save();
    return ex;
  });
  route('PUT', '/api/admin/exams/:id', 'admin', async (req) => {
    const ex = C.examById(req.params.id);
    if (!ex) fail(404, 'Exam not found');
    normalizeExam(await json(req), ex);
    ex.updatedAt = C.now();
    audit(req.user.id, 'exam.update', ex.title);
    save();
    return ex;
  });

  // ================================================================= ADMIN: results, certificates, reports
  route('GET', '/api/admin/attempts', 'manager', async (req) => {
    const { courseId, result } = req.query;
    return db.attempts
      .filter((a) => a.submittedAt && canManage(req.user, a.userId))
      .filter((a) => !courseId || a.courseId === courseId)
      .filter((a) => !result || (result === 'pass' ? a.passed : !a.passed))
      .map((a) => C.attemptView(a, false))
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  });
  route('GET', '/api/admin/certificates', 'manager', async (req) =>
    db.certificates.filter((c) => canManage(req.user, c.userId)).map(C.certView).map((c) => ({ ...c, user: C.pubUser(C.userById(c.userId)) })).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)));
  route('POST', '/api/admin/certificates/:id/revoke', 'admin', async (req) => {
    const c = db.certificates.find((x) => x.id === req.params.id);
    if (!c) fail(404, 'Certificate not found');
    const { reason } = await json(req);
    c.revokedAt = C.now();
    c.revokedReason = reason || '';
    audit(req.user.id, 'certificate.revoke', c.code);
    save();
    return C.certView(c);
  });
  route('GET', '/api/admin/report', 'manager', async (req) => C.report(isAdmin(req.user) ? null : (u) => u.managerId === req.user.id));
  route('GET', '/api/admin/settings', 'admin', async () => db.settings);
  route('PUT', '/api/admin/settings', 'admin', async (req) => {
    const b = await json(req);
    for (const k of ['orgName', 'brandColor', 'certSigner', 'certSignerTitle']) if (b[k] !== undefined) db.settings[k] = String(b[k]);
    if (b.passwordMin !== undefined) db.settings.passwordMin = Math.max(6, Number(b.passwordMin) || 8);
    audit(req.user.id, 'settings.update', '');
    save();
    return db.settings;
  });
  route('GET', '/api/admin/audit', 'admin', async () => db.audit.slice(-500).reverse().map((a) => ({ ...a, user: a.userId ? (C.userById(a.userId) || {}).name : '' })));

  // ---- CSV exports (GET so the browser downloads directly)
  const csvResponse = (res, name, rows) => env.csv(res, name, rows);
  route('GET', '/api/export/enrollments.csv', 'manager', async (req, res) => {
    const rows = [['Employee ID', 'Name', 'Email', 'Department', 'Job title', 'Course code', 'Course', 'Status', 'Progress %', 'Score %', 'Required', 'Due date', 'Overdue', 'Enrolled', 'Completed', 'Certificate', 'Certificate status', 'Certificate expires']];
    db.enrollments.filter((e) => canManage(req.user, e.userId)).map(C.enrollmentView).filter((e) => e.course && e.user).forEach((e) => rows.push([
      e.user.empId, e.user.name, e.user.email, e.user.department, e.user.title, e.course.code, e.course.title, e.status, e.progressPct, e.score ?? '',
      e.required ? 'Yes' : 'No', e.dueDate, e.overdue ? 'Yes' : 'No', (e.enrolledAt || '').slice(0, 10), (e.completedAt || '').slice(0, 10),
      e.certificate ? e.certificate.code : '', e.certificate ? e.certificate.status : '', e.certificate && e.certificate.expiresAt ? e.certificate.expiresAt.slice(0, 10) : '',
    ]));
    csvResponse(res, 'enrollments.csv', rows);
  });
  route('GET', '/api/export/attempts.csv', 'manager', async (req, res) => {
    const rows = [['Employee ID', 'Name', 'Department', 'Course', 'Exam', 'Attempt', 'Submitted', 'Score', 'Max', 'Percent', 'Pass mark', 'Result', 'Duration (min)', 'Auto-submitted']];
    db.attempts.filter((a) => a.submittedAt && canManage(req.user, a.userId)).map((a) => C.attemptView(a, false)).forEach((a) => rows.push([
      a.user && a.user.empId, a.user && a.user.name, a.user && a.user.department, a.courseTitle, a.title, a.attemptNo, a.submittedAt.replace('T', ' ').slice(0, 16),
      a.score, a.maxScore, a.pct, a.passPct, a.passed ? 'PASS' : 'FAIL', Math.round((a.durationSec || 0) / 6) / 10, a.autoSubmitted ? 'Yes' : 'No',
    ]));
    csvResponse(res, 'exam-results.csv', rows);
  });
  route('GET', '/api/export/employees.csv', 'admin', async (req, res) => {
    const rows = [['empId', 'name', 'email', 'department', 'title', 'location', 'role', 'managerEmail', 'hireDate', 'active']];
    db.users.forEach((u) => rows.push([u.empId, u.name, u.email, u.department, u.title, u.location, u.role, (C.userById(u.managerId) || {}).email || '', u.hireDate, u.active ? 'yes' : 'no']));
    csvResponse(res, 'employees.csv', rows);
  });
}

module.exports = { registerRoutes, makeRouter, guard, isAdmin, canManage };
