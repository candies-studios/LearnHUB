'use strict';
/* LearnHub — manager & administrator screens */

// ------------------------------------------------------------ shared: assign modal
async function openAssign(preset = {}) {
  const [courses, people] = await Promise.all([
    GET('/api/admin/courses'),
    isAdmin() ? GET('/api/admin/users') : GET('/api/team'),
  ]);
  const pubCourses = courses.filter((c) => c.status === 'published');
  if (!pubCourses.length) return toast('Publish a course first', 'bad');
  const active = people.filter((u) => u.active);
  const depts = [...new Set(active.map((u) => u.department).filter(Boolean))].sort();
  const sel = new Set(preset.userIds || []);
  const selD = new Set();
  modal({
    title: 'Assign training', wide: true, okText: 'Assign',
    body: `<div class="form-grid">
      <div class="field full"><label class="f">Course</label><select id="ac">${pubCourses.map((c) => `<option value="${c.id}" ${c.id === preset.courseId ? 'selected' : ''}>${esc(c.title)}${c.code ? ' (' + esc(c.code) + ')' : ''}</option>`).join('')}</select></div>
      <div class="field"><label class="f">Due date</label><input type="date" id="ad" value="${new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)}"><div class="hint">Leave empty for no deadline</div></div>
      <div class="field" style="padding-top:22px"><label class="check"><input type="checkbox" id="ar" checked> Required training</label><label class="check" style="margin-top:6px"><input type="checkbox" id="ax"> Reset completed learners (recertification)</label></div>
      ${isAdmin() && depts.length ? `<div class="field full"><label class="f">Whole departments</label><div class="chips" id="adp">${depts.map((d) => `<span class="chip" data-d="${esc(d)}">${esc(d)}</span>`).join('')}</div><div class="hint">Everyone active in the selected departments is included.</div></div>` : ''}
      <div class="field full"><div class="row between" style="margin-bottom:6px"><label class="f" style="margin:0">Individual employees <span class="muted" id="cnt"></span></label><div class="row"><input type="search" id="aq" placeholder="Filter…" style="width:200px;padding:5px 10px"><button class="btn sm" id="aall">Select shown</button><button class="btn sm ghost" id="anone">Clear</button></div></div>
        <div class="picker" id="apk"></div></div></div>`,
    onOpen: (root) => {
      let q = '';
      const shown = () => active.filter((u) => !q || (u.name + u.email + u.department + u.empId).toLowerCase().includes(q));
      const draw = () => {
        $('#apk', root).innerHTML = shown().map((u) => `<label><input type="checkbox" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''}><span class="grow"><b>${esc(u.name)}</b> <span class="muted small">${esc(u.empId || '')} · ${esc(u.title || '')}</span></span><span class="small muted">${esc(u.department || '')}</span></label>`).join('') || '<div class="empty">No employees</div>';
        $$('#apk input', root).forEach((i) => (i.onchange = () => { i.checked ? sel.add(i.value) : sel.delete(i.value); count(); }));
        count();
      };
      const count = () => { $('#cnt', root).textContent = `(${sel.size} selected${selD.size ? ` + ${selD.size} dept${selD.size > 1 ? 's' : ''}` : ''})`; };
      $('#aq', root).oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
      $('#aall', root).onclick = () => { shown().forEach((u) => sel.add(u.id)); draw(); };
      $('#anone', root).onclick = () => { sel.clear(); draw(); };
      $$('#adp .chip', root).forEach((ch) => (ch.onclick = () => { ch.classList.toggle('on'); ch.classList.contains('on') ? selD.add(ch.dataset.d) : selD.delete(ch.dataset.d); count(); }));
      draw();
    },
    ok: async (root) => {
      if (!sel.size && !selD.size) throw new Error('Pick at least one employee or department');
      const r = await POST('/api/assign', { courseId: val(root, '#ac'), userIds: [...sel], departments: [...selD], dueDate: val(root, '#ad'), required: val(root, '#ar'), reset: val(root, '#ax') });
      toast(`Assigned: ${r.created} new${r.updated ? `, ${r.updated} updated` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`, 'ok');
      if (preset.after) preset.after();
    },
  });
}

async function openLearning(userId, after) {
  const d = await GET(`/api/admin/users/${userId}/learning`);
  const m = modal({
    title: d.user.name + ' — learning record', wide: true, footer: false,
    body: `<div class="row between" style="margin-bottom:14px"><div class="muted small">${esc(d.user.empId || '')} · ${esc(d.user.title || '')} · ${esc(d.user.department || '')} · ${esc(d.user.email)}</div><button class="btn sm primary" id="asg">${I('plus')}Assign course</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Score</th><th>Due</th><th>Certificate</th><th></th></tr></thead><tbody>
      ${d.enrollments.map((e) => `<tr><td class="name"><b>${esc(e.course.title)}</b><span>${e.required ? 'Required' : 'Optional'}${e.manualCompletion ? ' · recorded manually' : ''}</span></td><td>${pill(e.status, e.overdue)}</td><td style="min-width:110px">${progress(e.progressPct)}</td><td>${e.score != null ? e.score + '%' : '—'}</td><td class="nowrap">${fmtDate(e.dueDate)}</td>
        <td>${e.certificate ? `<a target="_blank" href="${esc(certLink(e.certificate.code))}">${esc(e.certificate.code)}</a><br>${pill(e.certificate.status)}` : '—'}</td>
        <td class="actions"><select data-act="${e.id}" style="width:auto;padding:4px 8px;font-size:12.5px"><option value="">Actions…</option><option value="due">Change due date</option>${e.status === 'failed' || e.status === 'in_progress' ? '<option value="attempt">Grant extra exam attempt</option>' : ''}${isAdmin() && e.status !== 'completed' ? '<option value="complete">Record as completed</option>' : ''}${isAdmin() ? '<option value="remove">Remove enrollment</option>' : ''}</select></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No enrollments</td></tr>'}
      </tbody></table></div>
      <h3 style="margin:20px 0 8px">Exam attempts</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Exam</th><th>Attempt</th><th>Date</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody>
      ${d.attempts.map((a) => `<tr><td>${esc(a.title)}</td><td>#${a.attemptNo}</td><td>${fmtDT(a.submittedAt)}</td><td><b>${a.pct}%</b></td><td>${a.passed ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td><td class="actions"><a class="btn sm" href="#/result/${a.id}">Review</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No attempts</td></tr>'}
      </tbody></table></div>`,
  });
  const reopen = () => { m.close(); openLearning(userId, after); if (after) after(); };
  $('#asg', m.root).onclick = () => { m.close(); openAssign({ userIds: [userId], after }); };
  $$('[data-act]', m.root).forEach((s) => (s.onchange = async () => {
    const id = s.dataset.act, act = s.value; s.value = '';
    try {
      if (act === 'attempt') { await POST(`/api/admin/enrollments/${id}/extra-attempt`); toast('Extra attempt granted', 'ok'); reopen(); }
      if (act === 'remove' && await confirmBox('Remove this enrollment? Progress for this course is deleted (exam attempts stay in the results log).', 'Remove', true)) { await DEL('/api/admin/enrollments/' + id); reopen(); }
      if (act === 'complete') modal({ title: 'Record completion', okText: 'Mark completed', body: `<p>Use this for classroom sessions, on-the-job sign-offs or external training. A certificate is issued if the course has one.</p><div class="field"><label class="f">Note (evidence, trainer, date…)</label><textarea id="nt"></textarea></div>`, ok: async (r) => { await POST(`/api/admin/enrollments/${id}/complete`, { note: val(r, '#nt') }); toast('Recorded', 'ok'); reopen(); } });
      if (act === 'due') modal({ title: 'Change due date', body: `<div class="field"><label class="f">Due date</label><input type="date" id="dd"></div>`, ok: async (r) => { await POST(`/api/admin/enrollments/${id}/due`, { dueDate: val(r, '#dd') }); reopen(); } });
    } catch (e) { fail(e); }
  }));
}

function kpiTiles(k) {
  return `<div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="l">Completion rate</div><div class="v">${k.completionRate}%</div><div class="s">${k.completed} of ${k.enrollments} enrollments</div></div>
    <div class="card kpi ${k.overdue ? 'alert' : ''}"><div class="l">Overdue</div><div class="v">${k.overdue}</div><div class="s">assignments past due</div></div>
    <div class="card kpi"><div class="l">Exam pass rate</div><div class="v">${k.passRate}%</div><div class="s">${k.attempts} attempts · avg ${k.avgScore}%</div></div>
    <div class="card kpi ${k.certificatesExpiring + k.certificatesExpired ? 'alert' : ''}"><div class="l">Valid certificates</div><div class="v">${k.certificatesValid}</div><div class="s">${k.certificatesExpiring} expiring · ${k.certificatesExpired} expired</div></div>
  </div>`;
}
function courseTable(rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Course</th><th class="right">Enrolled</th><th style="min-width:150px">Completed</th><th class="right">In progress</th><th class="right">Failed</th><th class="right">Overdue</th><th class="right">Avg score</th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td class="name"><b>${esc(c.title)}</b><span>${esc(c.code || '')} ${c.type === 'scorm' ? '· SCORM' : ''}</span></td><td class="right">${c.enrolled}</td><td>${progress(c.enrolled ? Math.round((c.completed / c.enrolled) * 100) : 0)}<span class="small muted">${c.completed} learners</span></td><td class="right">${c.inProgress}</td><td class="right">${c.failed || '—'}</td><td class="right">${c.overdue ? `<b style="color:var(--bad)">${c.overdue}</b>` : '—'}</td><td class="right">${c.avgScore != null ? c.avgScore + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No courses</td></tr>'}
  </tbody></table></div>`;
}

// ------------------------------------------------------------ manager: my team
on('/team', async (el) => {
  const [team, rep] = await Promise.all([GET('/api/team'), GET('/api/team/report')]);
  const draw = () => {};
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>My team</h1><p>${team.length} direct report${team.length === 1 ? '' : 's'}</p></div><div class="row"><a class="btn" href="/api/export/enrollments.csv">${I('download')}Export CSV</a><button class="btn primary" id="as">${I('plus')}Assign training</button></div></div>
    ${kpiTiles(rep.kpis)}
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Employee</th><th>Department</th><th class="right">Assigned</th><th class="right">Completed</th><th class="right">Overdue</th><th style="min-width:150px">Completion</th><th></th></tr></thead><tbody>
    ${team.map((u) => {
      const n = u.enrollments.length, c = u.enrollments.filter((e) => e.status === 'completed').length, o = u.enrollments.filter((e) => e.overdue).length;
      return `<tr><td class="name"><b>${esc(u.name)}</b><span>${esc(u.title || '')} · ${esc(u.empId || '')}</span></td><td>${esc(u.department || '')}</td><td class="right">${n}</td><td class="right">${c}</td><td class="right">${o ? `<b style="color:var(--bad)">${o}</b>` : '—'}</td><td>${progress(n ? Math.round((c / n) * 100) : 0)}</td><td class="actions"><button class="btn sm" data-u="${u.id}">View learning</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="empty"><b>No direct reports</b>HR sets reporting lines on the Employees page.</td></tr>'}
    </tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>Course completion — my team</h3></div>${courseTable(rep.byCourse.filter((c) => c.enrolled))}</div></div>`;
  $('#as').onclick = () => openAssign({ after: render });
  $$('[data-u]').forEach((b) => (b.onclick = () => openLearning(b.dataset.u, render)));
}, { role: 'manager', nav: '/team' });

// ------------------------------------------------------------ admin: dashboard
on('/admin', async (el) => {
  const r = await GET('/api/admin/report');
  const k = r.kpis;
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Learning dashboard</h1><p>${k.employees} active employees · ${k.courses} published courses</p></div>
      <div class="row"><a class="btn" href="/api/export/enrollments.csv">${I('download')}Enrollments CSV</a><a class="btn" href="/api/export/attempts.csv">${I('download')}Exam results CSV</a><button class="btn primary" id="as">${I('plus')}Assign training</button></div></div>
    ${kpiTiles(k)}
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Completion by course</h3><a href="#/admin/courses" class="small">Manage courses →</a></div>${courseTable(r.byCourse)}</div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h3>Completion by department</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Department</th><th class="right">People</th><th style="min-width:140px">Completion</th><th class="right">Overdue</th></tr></thead><tbody>
        ${r.byDept.map((d) => `<tr><td><b>${esc(d.department)}</b></td><td class="right">${d.employees}</td><td>${progress(d.enrolled ? Math.round((d.completed / d.enrolled) * 100) : 0)}</td><td class="right">${d.overdue ? `<b style="color:var(--bad)">${d.overdue}</b>` : '—'}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Recent exam results</h3><a href="#/admin/results" class="small">All results →</a></div><div class="tbl-wrap"><table class="tbl"><tbody>
        ${r.recentAttempts.map((a) => `<tr><td class="name"><b>${esc(a.user ? a.user.name : '')}</b><span>${esc(a.title)}</span></td><td class="nowrap small muted">${fmtDT(a.submittedAt)}</td><td><b>${a.pct}%</b></td><td>${a.passed ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td><td class="actions"><a class="btn sm" href="#/result/${a.id}">View</a></td></tr>`).join('') || '<tr><td class="empty">No attempts yet</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Overdue assignments</h3><a href="#/admin/assignments?status=overdue" class="small">View all →</a></div><div class="tbl-wrap"><table class="tbl"><tbody>
        ${r.overdue.slice(0, 8).map((e) => `<tr><td class="name"><b>${esc(e.user.name)}</b><span>${esc(e.user.department || '')}</span></td><td>${esc(e.course.title)}</td><td class="nowrap" style="color:var(--bad)">Due ${fmtDate(e.dueDate)}</td></tr>`).join('') || '<tr><td class="empty">Nothing overdue 🎉</td></tr>'}
      </tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Certificates needing renewal</h3><a href="#/admin/certificates" class="small">All certificates →</a></div><div class="tbl-wrap"><table class="tbl"><tbody>
        ${r.expiring.slice(0, 8).map((c) => `<tr><td class="name"><b>${esc(c.userName)}</b><span>${esc(c.courseTitle)}</span></td><td>${pill(c.status)}</td><td class="nowrap small">${fmtDate(c.expiresAt)}</td></tr>`).join('') || '<tr><td class="empty">No certificates expiring in the next 30 days</td></tr>'}
      </tbody></table></div></div>
    </div></div>`;
  $('#as').onclick = () => openAssign({ after: render });
}, { role: 'admin', nav: '/admin' });

// ------------------------------------------------------------ admin: employees
function userForm(u, all) {
  u = u || {};
  const managers = all.filter((x) => x.id !== u.id && x.active && (x.role === 'manager' || x.role === 'admin'));
  const depts = [...new Set(all.map((x) => x.department).filter(Boolean))].sort();
  return `<div class="form-grid">
    <div class="field"><label class="f">Full name *</label><input type="text" id="un" value="${esc(u.name)}"></div>
    <div class="field"><label class="f">Work email *</label><input type="email" id="ue" value="${esc(u.email)}"></div>
    <div class="field"><label class="f">Employee ID</label><input type="text" id="ui" value="${esc(u.empId)}"></div>
    <div class="field"><label class="f">Job title</label><input type="text" id="ut" value="${esc(u.title)}"></div>
    <div class="field"><label class="f">Department</label><input type="text" id="ud" list="dl" value="${esc(u.department)}"><datalist id="dl">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
    <div class="field"><label class="f">Location</label><input type="text" id="ul" value="${esc(u.location)}"></div>
    <div class="field"><label class="f">Manager</label><select id="um"><option value="">— None —</option>${managers.map((m) => `<option value="${m.id}" ${m.id === u.managerId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><div class="hint">Only users with the Manager or Admin role are listed.</div></div>
    <div class="field"><label class="f">Hire date</label><input type="date" id="uh" value="${esc(u.hireDate)}"></div>
    <div class="field"><label class="f">Role</label><select id="ur">${['employee', 'manager', 'admin'].map((r) => `<option value="${r}" ${r === (u.role || 'employee') ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select><div class="hint">Managers see and assign training to their direct reports. Admins manage everything.</div></div>
    ${u.id ? `<div class="field" style="padding-top:22px"><label class="check"><input type="checkbox" id="ua" ${u.active ? 'checked' : ''}> Active account</label></div>` : `<div class="field"><label class="f">Initial password</label><input type="text" id="up" placeholder="Leave empty to generate one"><div class="hint">The employee must change it at first sign-in.</div></div>`}
  </div>`;
}
const readUser = (r) => ({ name: val(r, '#un'), email: val(r, '#ue'), empId: val(r, '#ui'), title: val(r, '#ut'), department: val(r, '#ud'), location: val(r, '#ul'), managerId: val(r, '#um'), hireDate: val(r, '#uh'), role: val(r, '#ur') });
function showPassword(name, email, pw) {
  modal({ title: 'Temporary password', okText: 'Done', ok: () => true, cancelText: 'Close', body: `<p>Share these sign-in details with <b>${esc(name)}</b>. They will be asked to choose a new password.</p><pre class="k">Sign-in: ${esc(location.origin)}\nEmail:   ${esc(email)}\nPassword: ${esc(pw)}</pre><button class="btn sm" id="cpy">Copy</button>`,
    onOpen: (r) => { $('#cpy', r).onclick = () => { navigator.clipboard.writeText(`Sign-in: ${location.origin}\nEmail: ${email}\nPassword: ${pw}`); toast('Copied'); }; } });
}

on('/admin/employees', async (el) => {
  let users = await GET('/api/admin/users');
  let q = '', fd = '', fr = '', fs = 'active';
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Employees</h1><p id="sub"></p></div>
    <div class="row"><a class="btn" href="/api/export/employees.csv">${I('download')}Export</a><button class="btn" id="imp">${I('upload')}Import CSV</button><button class="btn primary" id="add">${I('plus')}Add employee</button></div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search name, email, ID…"><select id="fd"></select><select id="fr"><option value="">All roles</option><option value="employee">Employees</option><option value="manager">Managers</option><option value="admin">Admins</option></select><select id="fs"><option value="active">Active</option><option value="inactive">Deactivated</option><option value="">All</option></select></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Manager</th><th>Role</th><th class="right">Learning</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const byId = () => Object.fromEntries(users.map((u) => [u.id, u]));
  const draw = () => {
    const ix = byId();
    const depts = [...new Set(users.map((u) => u.department).filter(Boolean))].sort();
    $('#fd').innerHTML = `<option value="">All departments</option>` + depts.map((d) => `<option ${d === fd ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const rows = users.filter((u) => (!q || (u.name + ' ' + u.email + ' ' + u.empId + ' ' + u.title).toLowerCase().includes(q)) && (!fd || u.department === fd) && (!fr || u.role === fr) && (!fs || (fs === 'active' ? u.active : !u.active)));
    $('#sub').textContent = `${users.filter((u) => u.active).length} active · showing ${rows.length}`;
    $('#tb').innerHTML = rows.map((u) => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(u.name))}</span><div class="name"><b>${esc(u.name)}</b><span>${esc(u.email)}${u.title ? ' · ' + esc(u.title) : ''}</span></div></div></td>
      <td>${esc(u.empId || '—')}</td><td>${esc(u.department || '—')}</td><td>${esc((ix[u.managerId] || {}).name || '—')}</td><td><span class="pill ${u.role === 'admin' ? 'brand' : u.role === 'manager' ? 'info' : ''}">${u.role}</span></td>
      <td class="right nowrap small">${u.stats.completed}/${u.stats.enrolled} done${u.stats.overdue ? ` · <b style="color:var(--bad)">${u.stats.overdue} overdue</b>` : ''}</td><td>${u.active ? '<span class="pill ok">Active</span>' : '<span class="pill">Inactive</span>'}${u.mustChangePassword ? ' <span class="pill warn" title="Has not set their own password yet">Pending</span>' : ''}</td>
      <td class="actions"><button class="btn sm" data-l="${u.id}">Learning</button> <button class="btn sm" data-e="${u.id}">Edit</button> <button class="btn sm ghost" data-p="${u.id}" title="Reset password">🔑</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No employees match</td></tr>';
    $$('[data-l]').forEach((b) => (b.onclick = () => openLearning(b.dataset.l, reload)));
    $$('[data-e]').forEach((b) => (b.onclick = () => {
      const u = byId()[b.dataset.e];
      modal({ title: 'Edit employee', wide: true, body: userForm(u, users), ok: async (r) => { await PUT('/api/admin/users/' + u.id, { ...readUser(r), active: val(r, '#ua') }); toast('Saved', 'ok'); reload(); } });
    }));
    $$('[data-p]').forEach((b) => (b.onclick = async () => {
      const u = byId()[b.dataset.p];
      if (!(await confirmBox(`Reset the password for <b>${esc(u.name)}</b>? Their current password stops working.`, 'Reset password'))) return;
      try { const r = await POST(`/api/admin/users/${u.id}/reset-password`); showPassword(u.name, u.email, r.tempPassword); reload(); } catch (e) { fail(e); }
    }));
  };
  const reload = async () => { users = await GET('/api/admin/users'); draw(); };
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  $('#fd').onchange = (e) => { fd = e.target.value; draw(); };
  $('#fr').onchange = (e) => { fr = e.target.value; draw(); };
  $('#fs').onchange = (e) => { fs = e.target.value; draw(); };
  $('#add').onclick = () => modal({ title: 'Add employee', wide: true, okText: 'Create account', body: userForm(null, users), ok: async (r) => {
    const res = await POST('/api/admin/users', { ...readUser(r), password: val(r, '#up') || undefined });
    reload();
    if (res.tempPassword) setTimeout(() => showPassword(res.user.name, res.user.email, res.tempPassword), 50); else toast('Employee created', 'ok');
  } });
  $('#imp').onclick = () => modal({
    title: 'Import employees from CSV', wide: true, okText: 'Import',
    body: `<p>Upload or paste a CSV with a header row. Existing employees (matched by email) are updated; new ones get a temporary password.</p>
      <p class="small muted">Columns: <code class="k">empId, name, email, department, title, location, role, managerEmail, hireDate</code> — only <b>name</b> and <b>email</b> are required. Role is employee, manager or admin. Dates as YYYY-MM-DD.</p>
      <div class="row" style="margin-bottom:10px"><input type="file" id="cf" accept=".csv,text/csv"><button class="btn sm" id="tpl">${I('download')}Download template</button></div>
      <textarea id="ct" style="min-height:180px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px" placeholder="empId,name,email,department,title,location,role,managerEmail,hireDate"></textarea>`,
    onOpen: (r) => {
      $('#cf', r).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#ct', r).value = await f.text(); };
      $('#tpl', r).onclick = () => downloadText('employees-template.csv', 'empId,name,email,department,title,location,role,managerEmail,hireDate\nE1001,Priya Sharma,priya.sharma@company.com,Facilities,HVAC Technician,Pune,employee,manager@company.com,2024-04-01\n');
    },
    ok: async (r) => {
      const res = await POST('/api/admin/users/import', { csv: $('#ct', r).value });
      await reload();
      modal({ title: 'Import complete', okText: 'Done', ok: () => true, wide: true,
        body: `<p><b>${res.created.length}</b> created · <b>${res.updated}</b> updated${res.errors.length ? ` · <b style="color:var(--bad)">${res.errors.length} problems</b>` : ''}</p>
          ${res.errors.length ? `<div class="note bad" style="margin-bottom:12px"><div>${res.errors.map(esc).join('<br>')}</div></div>` : ''}
          ${res.created.length ? `<p>Temporary passwords for new accounts — download now, they are not shown again.</p><button class="btn primary" id="dlp">${I('download')}Download credentials CSV</button>` : ''}`,
        onOpen: (r2) => { const b = $('#dlp', r2); if (b) b.onclick = () => downloadText('new-accounts.csv', 'name,email,tempPassword\n' + res.created.map((c) => [c.name, c.email, c.tempPassword].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')); } });
    },
  });
  draw();
}, { role: 'admin', nav: '/admin/employees' });

// ------------------------------------------------------------ admin: courses
on('/admin/courses', async (el) => {
  const courses = await GET('/api/admin/courses');
  let show = 'live';
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Courses &amp; exams</h1><p>Build courses from videos, reading, documents and exams — or import SCORM packages.</p></div>
    <div class="row"><button class="btn" id="imp">${I('upload')}Import SCORM package</button><button class="btn primary" id="new">${I('plus')}New course</button></div></div>
    <div class="tabs" id="tabs"></div><div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Course</th><th>Type</th><th>Category</th><th>Status</th><th class="right">Enrolled</th><th class="right">Completed</th><th>Certificate</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const draw = () => {
    const live = courses.filter((c) => c.status !== 'archived'), arch = courses.filter((c) => c.status === 'archived');
    $('#tabs').innerHTML = `<button class="${show === 'live' ? 'on' : ''}" data-t="live">Active<span class="n">${live.length}</span></button><button class="${show === 'arch' ? 'on' : ''}" data-t="arch">Archived<span class="n">${arch.length}</span></button>`;
    $$('#tabs button').forEach((b) => (b.onclick = () => { show = b.dataset.t; draw(); }));
    const rows = show === 'live' ? live : arch;
    $('#tb').innerHTML = rows.map((c) => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="sw" style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center;color:#fff;background:${esc(courseColor(c))}">${I(typeIcon(c.type), 18)}</span><div class="name"><b><a href="#/admin/course/${c.id}">${esc(c.title)}</a></b><span>${esc(c.code || '')} · ${c.type === 'scorm' ? c.scorm.items.length : c.modules.length} modules · ${mins(c.durationMins)}</span></div></div></td>
      <td>${c.type === 'scorm' ? `<span class="pill info">SCORM ${esc(c.scorm.version)}</span>` : '<span class="pill">Native</span>'}</td><td>${esc(c.category || '')}</td>
      <td>${c.status === 'published' ? '<span class="pill ok">Published</span>' : c.status === 'draft' ? '<span class="pill warn">Draft</span>' : '<span class="pill">Archived</span>'}</td>
      <td class="right">${c.stats.enrolled}</td><td class="right">${c.stats.completed}</td><td class="small">${c.certificate && c.certificate.enabled ? (c.certificate.validityMonths ? `Valid ${c.certificate.validityMonths} mo` : 'No expiry') : '—'}</td>
      <td class="actions"><a class="btn sm" href="#/admin/course/${c.id}">Edit</a></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No courses</td></tr>';
  };
  $('#new').onclick = () => modal({
    title: 'New course', okText: 'Create course',
    body: `<div class="field"><label class="f">Course title *</label><input type="text" id="ct" placeholder="e.g. Fire Safety Induction"></div><div class="form-grid"><div class="field"><label class="f">Course code</label><input type="text" id="cc" placeholder="HSE-101"></div><div class="field"><label class="f">Category</label><input type="text" id="ck" value="General"></div></div>`,
    ok: async (r) => { const c = await POST('/api/admin/courses', { title: val(r, '#ct'), code: val(r, '#cc'), category: val(r, '#ck') }); location.hash = '#/admin/course/' + c.id; },
  });
  $('#imp').onclick = () => modal({
    title: 'Import SCORM package', okText: 'Upload & import',
    body: (LOCAL ? `<div class="note warn" style="margin-bottom:12px">SCORM import needs the server version of LearnHub. This demo already includes the Chiller SOP &amp; Lockout package.</div>` : '') + `<p>Upload a SCORM 1.2 or 2004 package as a <b>.zip</b> file (the zip must contain <code class="k">imsmanifest.xml</code>). Completion status, scores and bookmarks are tracked automatically.</p><div class="field"><input type="file" id="zf" accept=".zip,application/zip"></div><div id="upst" class="small muted"></div>`,
    ok: async (r) => {
      const f = $('#zf', r).files[0];
      if (!f) throw new Error('Choose a .zip file');
      $('#upst', r).textContent = `Uploading ${(f.size / 1048576).toFixed(1)} MB…`;
      const fd = new FormData(); fd.append('package', f);
      const c = await POST('/api/admin/scorm', fd);
      toast('Imported: ' + c.title + (c.alsoCreated ? ' — also created “' + c.alsoCreated + '”' : ''), 'ok');
      location.hash = '#/admin/course/' + c.id;
    },
  });
  draw();
}, { role: 'admin', nav: '/admin/courses' });

const MOD_TYPES = { video: ['Video', 'video'], text: ['Reading', 'text'], document: ['Document / PDF', 'document'], link: ['External link', 'link'], exam: ['Exam / assessment', 'exam'] };

async function uploadFile(file, statusEl) {
  if (statusEl) statusEl.textContent = `Uploading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`;
  const fd = new FormData(); fd.append('file', file);
  const r = await POST('/api/admin/upload', fd);
  if (statusEl) statusEl.textContent = 'Uploaded ✓';
  return r;
}

function moduleModal(m, onSave) {
  const t = m.type;
  let body = `<div class="field"><label class="f">Module title</label><input type="text" id="mt" value="${esc(m.title || '')}"></div>`;
  if (t === 'video') body += `<div class="field"><label class="f">Video file (MP4 recommended)</label><input type="file" id="mf" accept="video/*"><div class="hint" id="ms">${m.url ? 'Current: ' + esc(m.url) : 'Or paste a URL below'}</div></div><div class="field"><label class="f">…or video URL</label><input type="text" id="mu" value="${esc(m.url || '')}" placeholder="https://… .mp4"></div><label class="check"><input type="checkbox" id="mp" ${m.preventSkip ? 'checked' : ''}> Prevent skipping ahead (learner must watch the whole video)</label>`;
  if (t === 'document') body += `<div class="field"><label class="f">File (PDF shows inline; other files download)</label><input type="file" id="mf"><div class="hint" id="ms">${m.url ? 'Current: ' + esc(m.fileName || m.url) : ''}</div></div><div class="field"><label class="f">…or document URL</label><input type="text" id="mu" value="${esc(m.url || '')}"></div>`;
  if (t === 'link') body += `<div class="field"><label class="f">URL</label><input type="text" id="mu" value="${esc(m.url || '')}" placeholder="https://"></div>`;
  if (t === 'text') body += `<div class="field"><label class="f">Content</label><textarea id="mb" style="min-height:300px">${esc(m.body || '')}</textarea><div class="hint">Simple formatting: <code class="k"># Heading</code> <code class="k">**bold**</code> <code class="k">- bullet</code> <code class="k">1. numbered</code> <code class="k">[link](https://…)</code></div></div>`;
  modal({
    title: (m.id ? 'Edit ' : 'Add ') + MOD_TYPES[t][0].toLowerCase(), wide: t === 'text', body,
    ok: async (r) => {
      const out = { ...m, title: val(r, '#mt') || MOD_TYPES[t][0] };
      if (t === 'video' || t === 'document' || t === 'link') out.url = val(r, '#mu');
      const f = $('#mf', r) && $('#mf', r).files[0];
      if (f) { const up = await uploadFile(f, $('#ms', r)); out.url = up.url; out.fileName = up.fileName; if (!val(r, '#mt')) out.title = up.fileName; }
      if (t === 'video') out.preventSkip = val(r, '#mp');
      if (t === 'text') out.body = $('#mb', r).value;
      if ((t === 'video' || t === 'document' || t === 'link') && !out.url) throw new Error('Add a file or URL');
      await onSave(out);
    },
  });
}

on('/admin/course/:id', async (el, p) => {
  let c = await GET('/api/admin/courses/' + p.id);
  const save = async (patch, msg) => { c = await PUT('/api/admin/courses/' + c.id, { ...patch }); if (msg) toast(msg, 'ok'); return c; };
  const draw = () => {
    const isScorm = c.type === 'scorm';
    el.innerHTML = `<div class="page">
      <div class="crumbs"><a href="#/admin/courses">Courses</a> / ${esc(c.title)}</div>
      <div class="page-head"><div><h1>${esc(c.title)}</h1><p>${c.status === 'published' ? '<span class="pill ok">Published</span>' : c.status === 'draft' ? '<span class="pill warn">Draft — not visible to learners</span>' : '<span class="pill">Archived</span>'} · ${c.stats.enrolled} enrolled · ${c.stats.completed} completed</p></div>
        <div class="row">${c.status !== 'archived' ? `<button class="btn danger" id="arch">${I('trash')}${c.stats.enrolled ? 'Archive' : 'Delete'}</button>` : ''}<button class="btn" id="prev">${I('eye')}Preview as learner</button>${c.status === 'published' ? `<button class="btn" id="asg">${I('assign')}Assign</button><button class="btn" id="unp">Unpublish</button>` : `<button class="btn primary" id="pub">Publish</button>`}</div></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);align-items:start">
        <div class="card"><div class="card-h"><h3>${isScorm ? 'SCORM content' : 'Modules'}</h3>${!isScorm ? `<select id="addm" style="width:auto"><option value="">+ Add module…</option>${Object.entries(MOD_TYPES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>` : ''}</div><div class="card-b">
          ${isScorm ? `<p class="small muted">Package folder: <code class="k">${esc(c.scorm.dir)}</code> · SCORM ${esc(c.scorm.version)}. The package controls its own navigation; LearnHub records status and score for each part.</p>${c.scorm.items.map((it, i) => `<div class="mod-item"><span class="ic">${I('scorm')}</span><div class="grow name"><b>${i + 1}. ${esc(it.title)}</b><span class="small muted">${esc(it.href)}</span></div></div>`).join('')}`
          : c.modules.length ? c.modules.map((m, i) => `<div class="mod-item"><span class="ic">${I(MOD_TYPES[m.type][1])}</span><div class="grow name"><b>${i + 1}. ${esc(m.title)}</b><span class="small muted">${MOD_TYPES[m.type][0]}${m.type === 'video' && m.preventSkip ? ' · no skipping' : ''}${m.type === 'exam' ? ' · <span data-exinfo="' + m.examId + '"></span>' : ''}</span></div>
              ${m.type === 'exam' ? `<a class="btn sm primary" href="#/admin/exam/${m.examId}?course=${c.id}">Edit questions</a>` : `<button class="btn sm" data-ed="${i}">${I('edit')}</button>`}
              <button class="btn sm ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>${I('up')}</button><button class="btn sm ghost" data-dn="${i}" ${i === c.modules.length - 1 ? 'disabled' : ''}>${I('down')}</button><button class="btn sm ghost danger" data-rm="${i}">${I('trash')}</button></div>`).join('')
          : '<div class="empty"><b>No modules yet</b>Add videos, reading, documents and an exam using “Add module”.</div>'}
        </div></div>
        <div class="card"><div class="card-h"><h3>Course settings</h3></div><form class="card-b" id="cf">
          <div class="field"><label class="f">Title</label><input type="text" id="t" value="${esc(c.title)}"></div>
          <div class="form-grid"><div class="field"><label class="f">Code</label><input type="text" id="cd" value="${esc(c.code)}"></div><div class="field"><label class="f">Category</label><input type="text" id="ck" value="${esc(c.category)}"></div>
          <div class="field"><label class="f">Duration (minutes)</label><input type="number" id="du" min="0" value="${c.durationMins || 0}"></div><div class="field"><label class="f">Card colour</label><input type="color" id="co" value="${esc(c.color || '#0a6ed1')}"></div></div>
          <div class="field"><label class="f">Description</label><textarea id="ds">${esc(c.description)}</textarea></div>
          <label class="check"><input type="checkbox" id="se" ${c.selfEnroll !== false ? 'checked' : ''}> Show in catalog — employees can enrol themselves</label>
          ${!isScorm ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="sq" ${c.sequential ? 'checked' : ''}> Sequential — modules unlock in order</label>` : ''}
          <hr style="border:0;border-top:1px solid var(--line-2);margin:16px 0">
          <label class="check"><input type="checkbox" id="ce" ${c.certificate && c.certificate.enabled ? 'checked' : ''}> Issue a certificate on completion</label>
          <div class="field" style="margin-top:10px"><label class="f">Certificate validity (months)</label><input type="number" id="cv" min="0" value="${(c.certificate && c.certificate.validityMonths) || 0}"><div class="hint">0 = never expires. Expired certificates show on the dashboard for recertification.</div></div>
          <button class="btn primary">Save settings</button></form></div>
      </div></div>`;
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await save({ title: val(el, '#t'), code: val(el, '#cd'), category: val(el, '#ck'), durationMins: val(el, '#du'), color: val(el, '#co'), description: $('#ds').value, selfEnroll: val(el, '#se'), sequential: val(el, '#sq'), certificate: { enabled: val(el, '#ce'), validityMonths: val(el, '#cv') } }, 'Saved');
        c = await GET('/api/admin/courses/' + c.id); draw();
      } catch (x) { fail(x); }
    };
    const pubBtn = $('#pub'); if (pubBtn) pubBtn.onclick = async () => {
      if (c.type !== 'scorm' && !c.modules.length) return toast('Add at least one module before publishing', 'bad');
      await save({ status: 'published' }, 'Published — learners can now see this course'); c = await GET('/api/admin/courses/' + c.id); draw();
    };
    const unp = $('#unp'); if (unp) unp.onclick = async () => { await save({ status: 'draft' }, 'Moved back to draft'); c = await GET('/api/admin/courses/' + c.id); draw(); };
    const asg = $('#asg'); if (asg) asg.onclick = () => openAssign({ courseId: c.id });
    const arch = $('#arch'); if (arch) arch.onclick = async () => {
      if (!(await confirmBox(c.stats.enrolled ? 'Archive this course? It disappears from the catalog; existing records and certificates are kept.' : 'Delete this course permanently?', c.stats.enrolled ? 'Archive' : 'Delete', true))) return;
      await DEL('/api/admin/courses/' + c.id); location.hash = '#/admin/courses';
    };
    $('#prev').onclick = async () => { try { const r = await POST(`/api/catalog/${c.id}/enroll`); location.hash = '#/learn/' + r.id; } catch (x) { fail(x); } };
    const addm = $('#addm');
    if (addm) addm.onchange = async () => {
      const t = addm.value; addm.value = '';
      if (!t) return;
      if (t === 'exam') {
        const ex = await POST('/api/admin/exams', { title: c.title + ' — Assessment' });
        await save({ modules: [...c.modules, { type: 'exam', title: 'Final assessment', examId: ex.id }] });
        location.hash = `#/admin/exam/${ex.id}?course=${c.id}`;
        return;
      }
      moduleModal({ type: t }, async (m) => { await save({ modules: [...c.modules, m] }, 'Module added'); c = await GET('/api/admin/courses/' + c.id); draw(); });
    };
    const mods = () => c.modules.slice();
    $$('[data-ed]').forEach((b) => (b.onclick = () => { const i = +b.dataset.ed; moduleModal(c.modules[i], async (m) => { const a = mods(); a[i] = m; await save({ modules: a }, 'Saved'); c = await GET('/api/admin/courses/' + c.id); draw(); }); }));
    $$('[data-up]').forEach((b) => (b.onclick = async () => { const i = +b.dataset.up, a = mods(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; await save({ modules: a }); c = await GET('/api/admin/courses/' + c.id); draw(); }));
    $$('[data-dn]').forEach((b) => (b.onclick = async () => { const i = +b.dataset.dn, a = mods(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; await save({ modules: a }); c = await GET('/api/admin/courses/' + c.id); draw(); }));
    $$('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('Remove this module from the course?', 'Remove', true))) return;
      const a = mods(); a.splice(+b.dataset.rm, 1); await save({ modules: a }, 'Removed'); c = await GET('/api/admin/courses/' + c.id); draw();
    }));
    $$('[data-exinfo]').forEach(async (s) => { try { const ex = await GET('/api/admin/exams/' + s.dataset.exinfo); s.textContent = `${ex.questions.length} questions · pass ${ex.passPct}%${ex.timeLimitMins ? ' · ' + ex.timeLimitMins + ' min' : ''}`; } catch (e) {} });
  };
  draw();
}, { role: 'admin', nav: '/admin/courses' });

// ------------------------------------------------------------ admin: exam builder
on('/admin/exam/:id', async (el, p) => {
  const courseId = new URLSearchParams(location.hash.split('?')[1] || '').get('course');
  const ex = await GET('/api/admin/exams/' + p.id.split('?')[0]);
  let dirty = false;
  const blankQ = (type = 'single') => ({ type, text: '', explanation: '', points: 1, options: type === 'tf' ? [{ text: 'True', correct: true }, { text: 'False', correct: false }] : [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] });
  const qHtml = (q, i) => `<div class="qedit" data-q="${i}">
    <div class="row between" style="margin-bottom:10px"><b>Question ${i + 1}</b><div class="row"><select data-k="type" style="width:auto;padding:4px 8px"><option value="single" ${q.type === 'single' ? 'selected' : ''}>Multiple choice — one answer</option><option value="multi" ${q.type === 'multi' ? 'selected' : ''}>Multiple choice — several answers</option><option value="tf" ${q.type === 'tf' ? 'selected' : ''}>True / False</option></select>
      <label class="small muted">Points <input type="number" data-k="points" min="1" value="${q.points || 1}" style="width:64px;padding:4px 8px"></label>
      <button class="btn sm ghost" data-qa="up" ${i === 0 ? 'disabled' : ''}>${I('up')}</button><button class="btn sm ghost" data-qa="down" ${i === ex.questions.length - 1 ? 'disabled' : ''}>${I('down')}</button><button class="btn sm ghost" data-qa="dup" title="Duplicate">⧉</button><button class="btn sm ghost danger" data-qa="del">${I('trash')}</button></div></div>
    <textarea data-k="text" placeholder="Question text" style="min-height:60px">${esc(q.text)}</textarea>
    <div class="small muted" style="margin:10px 0 6px">Answer options — tick the correct answer${q.type === 'multi' ? 's' : ''}</div>
    ${q.options.map((o, j) => `<div class="oprow"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="c${i}" data-oc="${j}" ${o.correct ? 'checked' : ''} title="Correct answer"><input type="text" data-ot="${j}" value="${esc(o.text)}" placeholder="Option ${j + 1}" ${q.type === 'tf' ? 'readonly' : ''}>${q.type === 'tf' ? '<span></span>' : `<button class="btn sm ghost" data-orm="${j}" title="Remove option">×</button>`}</div>`).join('')}
    ${q.type !== 'tf' ? `<button class="btn sm ghost" data-oadd>+ Add option</button>` : ''}
    <input type="text" data-k="explanation" value="${esc(q.explanation)}" placeholder="Explanation shown after the exam (optional)" style="margin-top:10px">
  </div>`;
  const draw = () => {
    el.innerHTML = `<div class="page">
      <div class="crumbs"><a href="#/admin/courses">Courses</a>${courseId ? ` / <a href="#/admin/course/${courseId}">Course</a>` : ''} / Exam</div>
      <div class="page-head"><div><h1>${esc(ex.title)}</h1><p>${ex.questions.length} questions in the bank</p></div><div class="row"><button class="btn" id="csv">${I('upload')}Bulk add from CSV</button><button class="btn primary" id="sv">Save exam</button></div></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);align-items:start">
        <div><div id="qs">${ex.questions.map(qHtml).join('') || '<div class="card empty"><b>No questions yet</b>Add your first question below.</div>'}</div>
          <div class="row" style="margin-top:14px"><button class="btn" data-add="single">+ Multiple choice</button><button class="btn" data-add="multi">+ Multiple answer</button><button class="btn" data-add="tf">+ True / False</button></div></div>
        <div class="card" style="position:sticky;top:16px"><div class="card-h"><h3>Exam settings</h3></div><div class="card-b">
          <div class="field"><label class="f">Exam title</label><input type="text" id="et" value="${esc(ex.title)}"></div>
          <div class="form-grid"><div class="field"><label class="f">Pass mark (%)</label><input type="number" id="ep" min="0" max="100" value="${ex.passPct}"></div>
          <div class="field"><label class="f">Time limit (min)</label><input type="number" id="el" min="0" value="${ex.timeLimitMins}"><div class="hint">0 = untimed</div></div>
          <div class="field"><label class="f">Max attempts</label><input type="number" id="ea" min="0" value="${ex.maxAttempts}"><div class="hint">0 = unlimited</div></div>
          <div class="field"><label class="f">Questions per attempt</label><input type="number" id="ed" min="0" value="${ex.drawCount || 0}"><div class="hint">0 = all; otherwise random draw from the bank</div></div></div>
          <label class="check"><input type="checkbox" id="esq" ${ex.shuffleQuestions ? 'checked' : ''}> Shuffle question order</label>
          <label class="check" style="margin-top:6px"><input type="checkbox" id="eso" ${ex.shuffleOptions ? 'checked' : ''}> Shuffle answer options</label>
          <div class="field" style="margin-top:12px"><label class="f">After submitting, learners see</label><select id="er"><option value="always" ${ex.reviewAnswers === 'always' ? 'selected' : ''}>Correct answers and explanations</option><option value="after_pass" ${ex.reviewAnswers === 'after_pass' ? 'selected' : ''}>Correct answers only once they pass</option><option value="never" ${ex.reviewAnswers === 'never' ? 'selected' : ''}>Score and right/wrong only</option></select></div>
          <div class="field"><label class="f">Instructions</label><textarea id="ei" placeholder="Shown before the learner starts">${esc(ex.instructions || '')}</textarea></div>
        </div></div></div></div>`;
    bind();
  };
  const readSettings = () => Object.assign(ex, { title: val(el, '#et'), passPct: +val(el, '#ep'), timeLimitMins: +val(el, '#el'), maxAttempts: +val(el, '#ea'), drawCount: +val(el, '#ed'), shuffleQuestions: val(el, '#esq'), shuffleOptions: val(el, '#eso'), reviewAnswers: val(el, '#er'), instructions: $('#ei').value });
  const bind = () => {
    $$('[data-q]').forEach((box) => {
      const i = +box.dataset.q, q = ex.questions[i];
      $$('[data-k]', box).forEach((inp) => (inp.oninput = inp.onchange = () => {
        dirty = true;
        const k = inp.dataset.k;
        if (k === 'type') {
          const nt = inp.value;
          if (nt === 'tf') q.options = [{ text: 'True', correct: true }, { text: 'False', correct: false }];
          else if (q.type === 'tf') q.options = [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }];
          if (nt === 'single' && q.options.filter((o) => o.correct).length > 1) q.options.forEach((o, j) => (o.correct = j === q.options.findIndex((x) => x.correct)));
          q.type = nt; readSettings(); draw();
        } else q[k] = k === 'points' ? +inp.value : inp.value;
      }));
      $$('[data-ot]', box).forEach((inp) => (inp.oninput = () => { dirty = true; q.options[+inp.dataset.ot].text = inp.value; }));
      $$('[data-oc]', box).forEach((inp) => (inp.onchange = () => {
        dirty = true;
        if (q.type === 'multi') q.options[+inp.dataset.oc].correct = inp.checked;
        else q.options.forEach((o, j) => (o.correct = j === +inp.dataset.oc));
      }));
      $$('[data-orm]', box).forEach((b) => (b.onclick = () => { if (q.options.length <= 2) return toast('A question needs at least two options'); q.options.splice(+b.dataset.orm, 1); dirty = true; readSettings(); draw(); }));
      const oadd = $('[data-oadd]', box); if (oadd) oadd.onclick = () => { q.options.push({ text: '', correct: false }); dirty = true; readSettings(); draw(); };
      $$('[data-qa]', box).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.qa;
        if (a === 'del' && !(await confirmBox('Delete this question?', 'Delete', true))) return;
        readSettings();
        if (a === 'del') ex.questions.splice(i, 1);
        if (a === 'up') [ex.questions[i - 1], ex.questions[i]] = [ex.questions[i], ex.questions[i - 1]];
        if (a === 'down') [ex.questions[i + 1], ex.questions[i]] = [ex.questions[i], ex.questions[i + 1]];
        if (a === 'dup') ex.questions.splice(i + 1, 0, JSON.parse(JSON.stringify({ ...q, id: undefined, options: q.options.map((o) => ({ ...o, id: undefined })) })));
        dirty = true; draw();
      }));
    });
    $$('[data-add]').forEach((b) => (b.onclick = () => { readSettings(); ex.questions.push(blankQ(b.dataset.add)); dirty = true; draw(); const all = $$('.qedit'); const last = all[all.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('textarea', last).focus(); } }));
    $$('#et,#ep,#el,#ea,#ed,#esq,#eso,#er,#ei').forEach((i) => i.addEventListener('change', () => (dirty = true)));
    $('#sv').onclick = async () => {
      readSettings();
      try {
        const saved = await PUT('/api/admin/exams/' + ex.id, ex);
        Object.assign(ex, saved); dirty = false; toast('Exam saved', 'ok'); draw();
      } catch (e) { fail(e); }
    };
    $('#csv').onclick = () => modal({
      title: 'Bulk add questions from CSV', wide: true, okText: 'Add questions',
      body: `<p class="small">One question per row. Columns: <code class="k">type, question, option1, option2, option3, option4, …, correct, explanation</code></p>
        <ul class="small muted" style="margin-top:0"><li><b>type</b>: <code class="k">single</code>, <code class="k">multi</code> or <code class="k">tf</code></li><li><b>correct</b>: option number(s), e.g. <code class="k">2</code> or <code class="k">1;3</code>. For tf use <code class="k">true</code> or <code class="k">false</code>.</li><li>The last two columns are always <b>correct</b> and <b>explanation</b>; put as many options as you need between them.</li></ul>
        <div class="row" style="margin-bottom:8px"><input type="file" id="qf" accept=".csv"><button class="btn sm" id="qtpl">${I('download')}Template</button></div>
        <textarea id="qt" style="min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px"></textarea>`,
      onOpen: (r) => {
        $('#qf', r).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#qt', r).value = await f.text(); };
        $('#qtpl', r).onclick = () => downloadText('questions-template.csv', 'type,question,option1,option2,option3,option4,correct,explanation\nsingle,What colour is a fire extinguisher for electrical fires?,Red,Black (CO2),Cream (foam),Blue,2,CO2 extinguishers are safe on live electrical equipment.\ntf,You should use a lift during a fire evacuation.,,,,,false,Always use the stairs.\nmulti,Which are PPE?,Gloves,Goggles,Coffee mug,Hard hat,1;2;4,\n');
      },
      ok: (r) => {
        const rows = parseCsvClient($('#qt', r).value);
        if (rows.length && /^type$/i.test((rows[0][0] || '').trim())) rows.shift();
        let added = 0; const errs = [];
        rows.forEach((row, n) => {
          const type = (row[0] || '').trim().toLowerCase();
          const text = (row[1] || '').trim();
          const explanation = (row[row.length - 1] || '').trim();
          const correct = (row[row.length - 2] || '').trim().toLowerCase();
          const opts = row.slice(2, row.length - 2).map((s) => s.trim()).filter(Boolean);
          if (!['single', 'multi', 'tf'].includes(type) || !text) { errs.push(`Row ${n + 1}: needs a type and question`); return; }
          let q;
          if (type === 'tf') q = { type, text, explanation, points: 1, options: [{ text: 'True', correct: correct === 'true' || correct === '1' }, { text: 'False', correct: correct === 'false' || correct === '2' }] };
          else {
            const nums = correct.split(/[;|\s]+/).map(Number).filter((x) => x > 0);
            q = { type, text, explanation, points: 1, options: opts.map((t, j) => ({ text: t, correct: nums.includes(j + 1) })) };
          }
          if (q.options.length < 2 || !q.options.some((o) => o.correct)) { errs.push(`Row ${n + 1}: needs 2+ options and a correct answer`); return; }
          ex.questions.push(q); added++;
        });
        readSettings(); dirty = true; draw();
        toast(`${added} question${added === 1 ? '' : 's'} added — remember to save`, errs.length ? 'bad' : 'ok');
        if (errs.length) setTimeout(() => toast(errs.slice(0, 3).join(' · '), 'bad'), 300);
      },
    });
  };
  const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  S.cleanup.push(() => window.removeEventListener('beforeunload', warn));
  draw();
}, { role: 'admin', nav: '/admin/courses' });

function parseCsvClient(text) {
  const rows = []; let row = [], f = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ------------------------------------------------------------ admin: assignments
on('/admin/assignments', async (el) => {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  let fc = qs.get('course') || '', fst = qs.get('status') || '', fdp = '', q = '';
  const courses = await GET('/api/admin/courses');
  let rows = [];
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Assignments</h1><p id="sub">Who is enrolled in what, and how they're doing.</p></div><div class="row"><a class="btn" href="/api/export/enrollments.csv">${I('download')}Export CSV</a><button class="btn primary" id="as">${I('plus')}Assign training</button></div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search employee…"><select id="fc"><option value="">All courses</option>${courses.map((c) => `<option value="${c.id}" ${c.id === fc ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <select id="fst"><option value="">All statuses</option>${[['not_started', 'Not started'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['failed', 'Failed'], ['overdue', 'Overdue']].map(([k, l]) => `<option value="${k}" ${k === fst ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="fdp"></select></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Employee</th><th>Course</th><th>Status</th><th style="min-width:120px">Progress</th><th>Score</th><th>Due</th><th>Completed</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const load = async () => { rows = await GET(`/api/admin/enrollments?courseId=${encodeURIComponent(fc)}&status=${encodeURIComponent(fst)}`); draw(); };
  const draw = () => {
    const depts = [...new Set(rows.map((e) => e.user.department).filter(Boolean))].sort();
    $('#fdp').innerHTML = '<option value="">All departments</option>' + depts.map((d) => `<option ${d === fdp ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const list = rows.filter((e) => (!fdp || e.user.department === fdp) && (!q || (e.user.name + ' ' + e.user.email + ' ' + e.user.empId).toLowerCase().includes(q)));
    $('#sub').textContent = `${list.length} enrollment${list.length === 1 ? '' : 's'}`;
    $('#tb').innerHTML = list.map((e) => `<tr><td class="name"><b>${esc(e.user.name)}</b><span>${esc(e.user.empId || '')} · ${esc(e.user.department || '')}</span></td><td>${esc(e.course.title)}${e.required ? '' : ' <span class="small muted">(optional)</span>'}</td><td>${pill(e.status, e.overdue)}</td><td>${progress(e.progressPct)}</td><td>${e.score != null ? e.score + '%' : '—'}</td><td class="nowrap">${fmtDate(e.dueDate)}</td><td class="nowrap">${fmtDate(e.completedAt)}</td><td class="actions"><button class="btn sm" data-u="${e.user.id}">Manage</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No enrollments match</td></tr>';
    $$('[data-u]').forEach((b) => (b.onclick = () => openLearning(b.dataset.u, load)));
  };
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  $('#fc').onchange = (e) => { fc = e.target.value; load(); };
  $('#fst').onchange = (e) => { fst = e.target.value; load(); };
  $('#fdp').onchange = (e) => { fdp = e.target.value; draw(); };
  $('#as').onclick = () => openAssign({ courseId: fc, after: load });
  load();
}, { role: 'admin', nav: '/admin/assignments' });

// ------------------------------------------------------------ admin: results
on('/admin/results', async (el) => {
  const courses = await GET('/api/admin/courses');
  let fc = '', fr = '', q = '', rows = [];
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Exam results</h1><p id="sub"></p></div><a class="btn" href="/api/export/attempts.csv">${I('download')}Export CSV</a></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search employee…"><select id="fc"><option value="">All courses</option>${courses.filter((c) => c.type !== 'scorm').map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select><select id="fr"><option value="">Pass &amp; fail</option><option value="pass">Passed</option><option value="fail">Failed</option></select></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Employee</th><th>Exam</th><th>Attempt</th><th>Submitted</th><th>Duration</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>
    <p class="small muted" style="margin-top:12px">SCORM package scores appear on the Assignments page and in the enrollments export.</p></div>`;
  const load = async () => { rows = await GET(`/api/admin/attempts?courseId=${fc}&result=${fr}`); draw(); };
  const draw = () => {
    const list = rows.filter((a) => !q || (a.user && (a.user.name + ' ' + a.user.empId).toLowerCase().includes(q)));
    const pass = list.filter((a) => a.passed).length;
    $('#sub').textContent = `${list.length} attempts · ${list.length ? Math.round((pass / list.length) * 100) : 0}% pass rate · average ${list.length ? Math.round(list.reduce((s, a) => s + a.pct, 0) / list.length) : 0}%`;
    $('#tb').innerHTML = list.map((a) => `<tr><td class="name"><b>${esc(a.user ? a.user.name : '?')}</b><span>${esc(a.user ? a.user.department || '' : '')}</span></td><td class="name"><b>${esc(a.title)}</b><span>${esc(a.courseTitle)}</span></td><td>#${a.attemptNo}</td><td class="nowrap">${fmtDT(a.submittedAt)}</td><td>${dur(a.durationSec)}${a.autoSubmitted ? ' <span class="pill warn" title="Submitted when time ran out">timed out</span>' : ''}</td><td><b>${a.pct}%</b> <span class="small muted">${a.score}/${a.maxScore}</span></td><td>${a.passed ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td><td class="actions"><a class="btn sm" href="#/result/${a.id}">Answers</a></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No results yet</td></tr>';
  };
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  $('#fc').onchange = (e) => { fc = e.target.value; load(); };
  $('#fr').onchange = (e) => { fr = e.target.value; load(); };
  load();
}, { role: 'admin', nav: '/admin/results' });

// ------------------------------------------------------------ admin: certificates
on('/admin/certificates', async (el) => {
  let rows = await GET('/api/admin/certificates');
  let fs = '', q = '';
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Certificates</h1><p id="sub"></p></div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search name, course, ID…"><select id="fs"><option value="">All statuses</option><option value="valid">Valid</option><option value="expiring">Expiring in 30 days</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Certificate ID</th><th>Employee</th><th>Course</th><th>Score</th><th>Issued</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const draw = () => {
    const list = rows.filter((c) => (!fs || c.status === fs) && (!q || (c.code + ' ' + c.userName + ' ' + c.courseTitle).toLowerCase().includes(q)));
    $('#sub').textContent = `${rows.filter((c) => c.status === 'valid' || c.status === 'expiring').length} valid · ${rows.filter((c) => c.status === 'expiring').length} expiring soon · ${rows.filter((c) => c.status === 'expired').length} expired`;
    $('#tb').innerHTML = list.map((c) => `<tr><td><code class="k">${esc(c.code)}</code></td><td class="name"><b>${esc(c.userName)}</b><span>${esc(c.user ? c.user.department || '' : '')}</span></td><td>${esc(c.courseTitle)}</td><td>${c.score != null ? c.score + '%' : '—'}</td><td class="nowrap">${fmtDate(c.issuedAt)}</td><td class="nowrap">${c.expiresAt ? fmtDate(c.expiresAt) : 'Never'}</td><td>${pill(c.status)}</td>
      <td class="actions"><a class="btn sm" target="_blank" href="${esc(certLink(c.code))}">View</a> ${c.status !== 'revoked' ? `<button class="btn sm ghost danger" data-rv="${c.id}">Revoke</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No certificates</td></tr>';
    $$('[data-rv]').forEach((b) => (b.onclick = () => modal({ title: 'Revoke certificate', okText: 'Revoke', danger: true, body: `<p>The certificate page will show it as revoked. This can't be undone.</p><div class="field"><label class="f">Reason</label><input type="text" id="rr" placeholder="e.g. Issued in error"></div>`,
      ok: async (r) => { await POST(`/api/admin/certificates/${b.dataset.rv}/revoke`, { reason: val(r, '#rr') }); rows = await GET('/api/admin/certificates'); draw(); toast('Revoked'); } })));
  };
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  $('#fs').onchange = (e) => { fs = e.target.value; draw(); };
  draw();
}, { role: 'admin', nav: '/admin/certificates' });

// ------------------------------------------------------------ admin: settings & audit
on('/admin/settings', async (el) => {
  const s = await GET('/api/admin/settings');
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Settings</h1><p>Branding and certificate details</p></div></div>
    <div class="grid g2" style="align-items:start"><form class="card" id="sf"><div class="card-h"><h3>Organisation</h3></div><div class="card-b">
      <div class="field"><label class="f">Organisation name</label><input type="text" id="on" value="${esc(s.orgName)}"><div class="hint">Shown in the sidebar, sign-in page and certificates.</div></div>
      <div class="field"><label class="f">Brand colour</label><input type="color" id="bc" value="${esc(s.brandColor)}" style="max-width:120px"></div>
      <div class="field"><label class="f">Certificate signatory</label><input type="text" id="cs" value="${esc(s.certSigner)}"></div>
      <div class="field"><label class="f">Signatory title</label><input type="text" id="ct" value="${esc(s.certSignerTitle)}"></div>
      <div class="field"><label class="f">Minimum password length</label><input type="number" id="pm" min="6" value="${s.passwordMin}" style="max-width:120px"></div>
      <button class="btn primary">Save settings</button></div></form>
    <div class="card"><div class="card-h"><h3>Data &amp; backups</h3></div><div class="card-b prose" style="font-size:13.5px">
      <p>All data is stored in the <code class="k">data</code> folder next to the app: <code class="k">db.json</code> holds people, courses, results and certificates; <code class="k">content/</code> holds uploaded videos, documents and SCORM packages.</p>
      <p>A dated copy of the database is saved to <code class="k">data/backups</code> each day the server starts (last 14 kept). To back up everything, copy the whole <code class="k">data</code> folder.</p>
      ${LOCAL ? `<div class="note warn" style="display:block;margin-bottom:12px"><b>Demo mode (GitHub Pages).</b> This copy runs entirely in your browser: data is stored on this device only and is not shared with other people or devices. For a real shared system, run the server version (see DEPLOY.md).<div style="margin-top:10px"><button type="button" class="btn sm danger" id="rst">Reset demo data</button></div></div>` : ''}
      <p>Exports: <a href="/api/export/employees.csv">employees</a> · <a href="/api/export/enrollments.csv">enrollments</a> · <a href="/api/export/attempts.csv">exam results</a></p></div></div></div></div>`;
  const rst = $('#rst');
  if (rst) rst.onclick = async () => { if (await confirmBox('Erase everything in this browser and restore the original demo data?', 'Reset', true)) { window.LearnHubLocal.reset(); location.hash = '#/'; location.reload(); } };
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    try { S.settings = await PUT('/api/admin/settings', { orgName: val(el, '#on'), brandColor: val(el, '#bc'), certSigner: val(el, '#cs'), certSignerTitle: val(el, '#ct'), passwordMin: val(el, '#pm') }); toast('Saved', 'ok'); render(); } catch (x) { fail(x); }
  };
}, { role: 'admin', nav: '/admin/settings' });

on('/admin/audit', async (el) => {
  const rows = await GET('/api/admin/audit');
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Audit log</h1><p>Last ${rows.length} events</p></div></div>
    <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Event</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="nowrap small">${fmtDT(a.at)}</td><td>${esc(a.user || '—')}</td><td><code class="k">${esc(a.action)}</code></td><td class="small">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No events</td></tr>'}
    </tbody></table></div></div></div>`;
}, { role: 'admin', nav: '/admin/audit' });
