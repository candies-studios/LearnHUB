'use strict';
/* LearnHub front end — core, shell and learner experience. Admin screens live in admin.js */

// ------------------------------------------------------------ utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { me: null, settings: {}, teamSize: 0, cleanup: [] };

// GitHub Pages build: the API runs inside the browser (pages/learnhub-local.js) instead of on a server.
const LOCAL = !!(window.LH_LOCAL && window.LearnHubLocal);
const CONTENT = LOCAL ? 'content/' : '/content/';
const resolveUrl = (u) => (LOCAL ? window.LearnHubLocal.resolveUrl(u) : Promise.resolve(u));
const certLink = (code) => (LOCAL ? location.pathname + location.search + '#/cert/' + encodeURIComponent(code) : '/cert/' + encodeURIComponent(code));

async function api(method, url, body) {
  if (LOCAL) {
    const r = await window.LearnHubLocal.handle(method, url, body);
    if (r.status >= 400) {
      if (r.status === 401 && !url.includes('/api/login')) { S.me = null; render(); }
      throw new Error((r.data && r.data.error) || 'Error ' + r.status);
    }
    if (r.csv) { downloadText(r.csv.name, r.csv.text); return null; }
    return r.data;
  }
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && !url.includes('/api/login')) { S.me = null; render(); }
    throw new Error((data && data.error) || data || r.statusText);
  }
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b === undefined ? {} : b);
const PUT = (u, b) => api('PUT', u, b);
const DEL = (u) => api('DELETE', u);

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
}
const fail = (e) => toast(e.message || String(e), 'bad');

function modal({ title, body, ok, okText = 'Save', cancelText = 'Cancel', wide, danger, onOpen, footer = true }) {
  const root = document.createElement('div');
  root.className = 'overlay';
  root.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="mh"><h2>${esc(title)}</h2><button class="x" aria-label="Close">×</button></div>
    <div class="mb">${body}</div>
    ${footer ? `<div class="mf"><button class="btn" data-cancel>${esc(cancelText)}</button>${ok ? `<button class="btn primary ${danger ? 'danger solid' : ''}" data-ok>${esc(okText)}</button>` : ''}</div>` : ''}
  </div>`;
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  $('.x', root).onclick = close;
  const c = $('[data-cancel]', root); if (c) c.onclick = close;
  const okBtn = $('[data-ok]', root);
  if (okBtn) okBtn.onclick = async () => {
    okBtn.disabled = true;
    try { const r = await ok(root); if (r !== false) close(); } catch (e) { fail(e); } finally { okBtn.disabled = false; }
  };
  $('#modal-root').appendChild(root);
  const first = $('input:not([type=hidden]),select,textarea', $('.mb', root));
  if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(root, close);
  return { root, close };
}
function confirmBox(message, okText = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'Please confirm', body: `<p>${message}</p>`, okText, danger, ok: () => { done = true; resolve(true); } });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.root)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($('#modal-root'), { childList: true });
  });
}

const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const mins = (m) => (!m ? '' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''));
const dur = (s) => (s == null ? '—' : s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's');
const val = (root, sel) => { const el = $(sel, root); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : undefined; };

const I = (() => {
  const p = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    catalog: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0v16m4-14h7',
    transcript: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    cert: 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm-3.5 3.5L7 22l5-2 5 2-1.5-3.5',
    team: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm10 9v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.15a3.5 3.5 0 0 1 0 6.7',
    dash: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
    users: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    courses: 'M2 7l10-4 10 4-10 4zm4 2v5c0 1.7 2.7 3 6 3s6-1.3 6-3V9',
    assign: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
    results: 'M9 11l2 2 4-4m6 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
    audit: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    video: 'M15 10l5-3v10l-5-3zM3 6h12v12H3z',
    text: 'M4 6h16M4 12h16M4 18h10',
    document: 'M7 3h7l5 5v13H7zM14 3v5h5',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    exam: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
    scorm: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7.3 12 12l8.7-4.7M12 22V12',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
    menu: 'M3 6h18M3 12h18M3 18h18',
    plus: 'M12 5v14M5 12h14',
    upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z',
    trash: 'M3 6h18m-2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    up: 'M18 15l-6-6-6 6', down: 'M6 9l6 6 6-6', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', check: 'M20 6 9 17l-5-5', user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    back: 'M15 18l-6-6 6-6', print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  };
  const f = (name, size) => `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${p[name] || p.text}"/></svg>`;
  return f;
})();

const STATUS = {
  not_started: ['Not started', ''], in_progress: ['In progress', 'info'], completed: ['Completed', 'ok'], failed: ['Failed', 'bad'],
  valid: ['Valid', 'ok'], expiring: ['Expiring soon', 'warn'], expired: ['Expired', 'bad'], revoked: ['Revoked', 'bad'],
};
function pill(status, overdue) {
  if (overdue) return `<span class="pill bad">Overdue</span>`;
  const [t, k] = STATUS[status] || [status, ''];
  return `<span class="pill ${k}">${esc(t)}</span>`;
}
const progress = (pct) => `<div class="prog"><div class="bar ${pct >= 100 ? 'ok' : ''}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div><span>${pct || 0}%</span></div>`;
const typeIcon = (t) => ({ scorm: 'scorm', native: 'courses' }[t] || 'courses');
const courseColor = (c) => (c && c.color) || S.settings.brandColor || '#0a6ed1';

function md(src) {
  // tiny, safe markdown: headings, bold, italics, lists, links, paragraphs
  const lines = esc(src || '').split(/\r?\n/);
  let out = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code class="k">$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(l))) { closeList(); out += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) closeList();
    else { closeList(); out += `<p>${inline(l)}</p>`; }
  }
  closeList();
  return out;
}

function downloadText(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ router
const ROUTES = [];
function on(pattern, fn, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  ROUTES.push({ re, keys, fn, opts, pattern });
}
const isAdmin = () => S.me && S.me.role === 'admin';
const isManager = () => S.me && (S.me.role === 'manager' || S.me.role === 'admin');

async function render() {
  S.cleanup.splice(0).forEach((f) => { try { f(); } catch (e) {} });
  $('#modal-root').innerHTML = '';
  document.documentElement.style.setProperty('--brand', S.settings.brandColor || '#0a6ed1');
  document.title = (S.settings.orgName ? S.settings.orgName + ' · ' : '') + 'LearnHub';
  const app = $('#app');
  const certMatch = LOCAL && /^#\/cert\/([^/?]+)/.exec(location.hash);
  if (certMatch && document.readyState !== 'complete') { window.addEventListener('load', render, { once: true }); return; }
  if (certMatch) { document.open(); document.write(window.LearnHubLocal.certificatePage(decodeURIComponent(certMatch[1]))); document.close(); return; }
  if (!S.me) return renderLogin(app);
  if (S.me.mustChangePassword) return renderForceChange(app);
  const hash = (location.hash.slice(1) || '/').split('?')[0];
  for (const r of ROUTES) {
    const m = r.re.exec(hash);
    if (!m) continue;
    if (r.opts.role === 'admin' && !isAdmin()) break;
    if (r.opts.role === 'manager' && !isManager()) break;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    let target;
    if (r.opts.bare) { app.innerHTML = '<div id="bare"></div>'; target = $('#bare'); }
    else { shell(app, r.opts.nav || r.pattern); target = $('#page'); }
    target.innerHTML = '<div class="page"><div class="muted">Loading…</div></div>';
    try { await r.fn(target, params); } catch (e) { target.innerHTML = `<div class="page"><div class="note bad">${esc(e.message)}</div></div>`; }
    window.scrollTo(0, 0);
    return;
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);
if (LOCAL) {
  // CSV export links point at the server API; in the browser build generate the file locally instead
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="/api/export/"]');
    if (!a) return;
    e.preventDefault();
    GET(a.getAttribute('href')).catch(fail);
  });
}

function shell(app, active) {
  const me = S.me;
  const item = (href, icon, label, key, count) =>
    `<a href="#${href}" class="${active === key ? 'on' : ''}">${I(icon)}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;
  app.innerHTML = `<div class="shell" id="shell">
    <aside class="side">
      <div class="brand"><div class="logo">${I('courses', 18)}</div><div>${esc(S.settings.orgName || 'LearnHub')}<small>Learning &amp; Development</small></div></div>
      <nav class="nav">
        <div class="sec">My learning</div>
        ${item('/', 'home', 'Home', '/')}
        ${item('/catalog', 'catalog', 'Course catalog', '/catalog')}
        ${item('/transcript', 'transcript', 'Transcript', '/transcript')}
        ${item('/certificates', 'cert', 'My certificates', '/certificates')}
        ${isManager() && (S.teamSize || !isAdmin()) ? `<div class="sec">Manager</div>${item('/team', 'team', 'My team', '/team', S.teamSize)}` : ''}
        ${isAdmin() ? `<div class="sec">Administration</div>
          ${item('/admin', 'dash', 'Dashboard', '/admin')}
          ${item('/admin/employees', 'users', 'Employees', '/admin/employees')}
          ${item('/admin/courses', 'courses', 'Courses &amp; exams', '/admin/courses')}
          ${item('/admin/assignments', 'assign', 'Assignments', '/admin/assignments')}
          ${item('/admin/results', 'results', 'Exam results', '/admin/results')}
          ${item('/admin/certificates', 'cert', 'Certificates', '/admin/certificates')}
          ${item('/admin/settings', 'settings', 'Settings', '/admin/settings')}
          ${item('/admin/audit', 'audit', 'Audit log', '/admin/audit')}` : ''}
      </nav>
      <div class="me">
        <a href="#/profile" class="avatar" title="My profile">${esc(initials(me.name))}</a>
        <a href="#/profile" class="who" style="text-decoration:none"><b>${esc(me.name)}</b><span>${esc(me.title || me.role)}</span></a>
        <button title="Sign out" id="logout">${I('logout', 18)}</button>
      </div>
    </aside>
    <div class="main">
      <div class="topbar"><button id="navbtn" aria-label="Menu">${I('menu', 22)}</button><b>${esc(S.settings.orgName || 'LearnHub')}</b></div>
      <div id="page"></div>
    </div>
  </div>`;
  $('#logout').onclick = async () => { await POST('/api/logout'); S.me = null; location.hash = '#/'; render(); };
  $('#navbtn').onclick = () => $('#shell').classList.toggle('nav-open');
  $$('.nav a').forEach((a) => a.addEventListener('click', () => $('#shell').classList.remove('nav-open')));
}

// ------------------------------------------------------------ auth screens
function renderLogin(app) {
  app.innerHTML = `<div class="login">
    <div class="art">
      <div class="brand" style="padding:0"><div class="logo">${I('courses', 18)}</div><div>${esc(S.settings.orgName || 'LearnHub')}<small>Learning &amp; Development</small></div></div>
      <div>
        <h1>Grow your skills. Stay certified.</h1>
        <p>Your courses, assessments and certificates in one place.</p>
        <ul><li><i>✓</i>Assigned and self-paced training</li><li><i>✓</i>Timed assessments with instant results</li><li><i>✓</i>Verifiable certificates with renewal reminders</li></ul>
      </div>
      <div class="small" style="color:#7f93ab">Powered by LearnHub</div>
    </div>
    <div class="formside">
      <form id="lf" autocomplete="on">
        <h2>Sign in</h2>
        <p class="muted" style="margin-bottom:22px">Use your work email and password.</p>
        <div class="field"><label class="f" for="em">Work email</label><input type="email" id="em" required autocomplete="username"></div>
        <div class="field"><label class="f" for="pw">Password</label><input type="password" id="pw" required autocomplete="current-password"></div>
        <div id="lerr" class="note bad hidden" style="margin-bottom:14px"></div>
        <button class="btn primary lg" style="width:100%">Sign in</button>
        <p class="muted small" style="margin-top:18px">Forgot your password? Ask HR or your LMS administrator to reset it.</p>
        ${LOCAL ? `<div class="note" style="margin-top:18px;display:block"><b>Demo mode</b> — everything you do is saved only in this browser on this device.<br><span class="small">Try: <a href="#" data-demo="admin@company.local|Admin123!">Admin</a> · <a href="#" data-demo="anita.rao@example.com|Welcome123!">Manager</a> · <a href="#" data-demo="rahul.verma@example.com|Welcome123!">Employee</a></span></div>` : ''}
      </form>
    </div></div>`;
  $('#em').focus();
  $$('[data-demo]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const [em, pw] = a.dataset.demo.split('|'); $('#em').value = em; $('#pw').value = pw; $('#lf').requestSubmit(); }));
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#lf button'); btn.disabled = true;
    try {
      const r = await POST('/api/login', { email: $('#em').value, password: $('#pw').value });
      S.me = r.user;
      await loadMe();
      render();
    } catch (err) { const n = $('#lerr'); n.textContent = err.message; n.classList.remove('hidden'); btn.disabled = false; }
  };
}

function renderForceChange(app) {
  app.innerHTML = `<div class="login"><div class="art"><div class="brand" style="padding:0"><div class="logo">${I('courses', 18)}</div><div>${esc(S.settings.orgName)}</div></div><div><h1>Welcome, ${esc(S.me.name.split(' ')[0])}.</h1><p>Before you start, choose a new password for your account.</p></div><div></div></div>
  <div class="formside"><form id="pf"><h2>Set a new password</h2><p class="muted" style="margin-bottom:22px">At least ${S.settings.passwordMin || 8} characters.</p>
    <div class="field"><label class="f">Current / temporary password</label><input type="password" id="cur" required autocomplete="current-password"></div>
    <div class="field"><label class="f">New password</label><input type="password" id="nw" required autocomplete="new-password"></div>
    <div class="field"><label class="f">Confirm new password</label><input type="password" id="nw2" required autocomplete="new-password"></div>
    <div id="perr" class="note bad hidden" style="margin-bottom:14px"></div>
    <button class="btn primary lg" style="width:100%">Save and continue</button>
    <p style="margin-top:14px"><a href="#" id="so">Sign out</a></p></form></div></div>`;
  $('#so').onclick = async (e) => { e.preventDefault(); await POST('/api/logout'); S.me = null; render(); };
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#perr');
    try {
      if ($('#nw').value !== $('#nw2').value) throw new Error('The new passwords do not match');
      await POST('/api/me/password', { current: $('#cur').value, next: $('#nw').value });
      await loadMe(); toast('Password updated', 'ok'); render();
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
  };
}

async function loadMe() {
  const r = await GET('/api/me');
  S.me = r.user; S.settings = r.settings; S.teamSize = r.teamSize;
}

// ------------------------------------------------------------ learner: home
function learnRow(e) {
  const c = e.course;
  const btn = e.status === 'completed' ? 'Review' : e.status === 'not_started' ? 'Start' : e.status === 'failed' ? 'Open' : 'Continue';
  return `<div class="lrow">
    <div class="sw" style="background:${esc(courseColor(c))}">${I(typeIcon(c.type))}</div>
    <div class="t"><b>${esc(c.title)}</b><span>${[c.code, c.category, mins(c.durationMins), e.required ? 'Required' : 'Optional'].filter(Boolean).map(esc).join(' · ')}</span></div>
    <div class="pc">${progress(e.progressPct)}</div>
    <div class="due small">${e.status === 'completed' ? `<span class="muted">Completed</span><br>${fmtDate(e.completedAt)}` : e.dueDate ? `<span class="muted">Due</span><br><b style="color:${e.overdue ? 'var(--bad)' : 'inherit'}">${fmtDate(e.dueDate)}</b>` : '<span class="muted">No due date</span>'}</div>
    <div class="row" style="justify-content:flex-end">${pill(e.status, e.overdue)}
      ${e.certificate && e.certificate.status !== 'revoked' ? `<a class="btn sm" target="_blank" href="${esc(certLink(e.certificate.code))}">${I('cert')}Certificate</a>` : ''}
      <a class="btn sm ${e.status === 'completed' ? '' : 'primary'}" href="#/learn/${e.id}">${btn}</a></div>
  </div>`;
}

on('/', async (el) => {
  const [enrs, certs] = await Promise.all([GET('/api/my/enrollments'), GET('/api/my/certificates')]);
  const active = enrs.filter((e) => e.status !== 'completed');
  const overdue = enrs.filter((e) => e.overdue);
  const done = enrs.filter((e) => e.status === 'completed');
  const exp = certs.filter((c) => c.status === 'expiring' || c.status === 'expired');
  const tabs = { active: ['To do', active], overdue: ['Overdue', overdue], done: ['Completed', done], all: ['All', enrs] };
  let tab = overdue.length ? 'overdue' : 'active';
  const hour = new Date().getHours();
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${esc(S.me.name.split(' ')[0])}</h1><p>Here's what's on your learning plan.</p></div>
      <a class="btn" href="#/catalog">${I('catalog')}Browse catalog</a></div>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="card kpi"><div class="l">To do</div><div class="v">${active.length}</div><div class="s">${enrs.filter((e) => e.required && e.status !== 'completed').length} required</div></div>
      <div class="card kpi ${overdue.length ? 'alert' : ''}"><div class="l">Overdue</div><div class="v">${overdue.length}</div><div class="s">past due date</div></div>
      <div class="card kpi"><div class="l">Completed</div><div class="v">${done.length}</div><div class="s">all time</div></div>
      <div class="card kpi ${exp.length ? 'alert' : ''}"><div class="l">Certificates</div><div class="v">${certs.filter((c) => c.status === 'valid' || c.status === 'expiring').length}</div><div class="s">${exp.length ? exp.length + ' need renewal' : 'all current'}</div></div>
    </div>
    ${exp.length ? `<div class="note warn" style="margin-bottom:16px">${I('clock', 18)}<div><b>Certification renewal:</b> ${exp.map((c) => `${esc(c.courseTitle)} (${c.status === 'expired' ? 'expired' : 'expires'} ${fmtDate(c.expiresAt)})`).join(', ')}. Ask your manager to reassign the course, or retake it from the catalog.</div></div>` : ''}
    <div class="card"><div style="padding:0 18px"><div class="tabs" id="tabs" style="margin-bottom:0;border-bottom:0"></div></div><div id="list" style="border-top:1px solid var(--line-2)"></div></div>
  </div>`;
  const draw = () => {
    $('#tabs').innerHTML = Object.entries(tabs).map(([k, [t, arr]]) => `<button class="${k === tab ? 'on' : ''}" data-t="${k}">${t}<span class="n">${arr.length}</span></button>`).join('');
    $$('#tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const arr = tabs[tab][1].slice().sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
    $('#list').innerHTML = arr.length ? arr.map(learnRow).join('') : `<div class="empty"><b>${tab === 'overdue' ? 'Nothing overdue' : 'Nothing here yet'}</b>${tab === 'active' ? 'Courses assigned to you will appear here. You can also <a href="#/catalog">enrol yourself</a>.' : ''}</div>`;
  };
  draw();
});

// ------------------------------------------------------------ learner: catalog
on('/catalog', async (el) => {
  const list = await GET('/api/catalog');
  const cats = [...new Set(list.map((c) => c.category || 'General'))].sort();
  let cat = '', q = '';
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Course catalog</h1><p>${list.length} courses available</p></div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search courses…"><div class="chips" id="cats"></div></div>
    <div class="courses" id="grid"></div></div>`;
  const draw = () => {
    $('#cats').innerHTML = ['', ...cats].map((c) => `<span class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c || 'All')}</span>`).join('');
    $$('#cats .chip').forEach((ch) => (ch.onclick = () => { cat = ch.dataset.c; draw(); }));
    const rows = list.filter((c) => (!cat || c.category === cat) && (!q || (c.title + ' ' + c.description + ' ' + c.code).toLowerCase().includes(q)));
    $('#grid').innerHTML = rows.length ? rows.map((c) => `<div class="card ccard">
      <div class="thumb" style="background:linear-gradient(135deg, ${esc(courseColor(c))}, color-mix(in srgb, ${esc(courseColor(c))} 55%, #0f1b2b))"><span class="cat">${esc(c.category || 'General')}</span><span class="ico">${I(typeIcon(c.type))}</span></div>
      <div class="body"><h3>${esc(c.title)}</h3>
        <div class="meta"><span>${esc(c.code || '')}</span><span>${mins(c.durationMins)}</span><span>${c.moduleCount} ${c.moduleCount === 1 ? 'module' : 'modules'}</span>${c.certificate ? '<span>🏅 Certificate</span>' : ''}</div>
        <div class="desc">${esc(c.description || '')}</div>
        <div class="foot">${c.enrollment ? pill(c.enrollment.status) + `<a class="btn sm primary" href="#/learn/${c.enrollment.id}">${c.enrollment.status === 'completed' ? 'Review' : 'Continue'}</a>`
          : c.selfEnroll ? `<span class="muted small">Self-enrol</span><button class="btn sm primary" data-enrol="${c.id}">Enrol</button>` : `<span class="muted small">Assigned by HR only</span>`}</div>
      </div></div>`).join('') : `<div class="empty card" style="grid-column:1/-1"><b>No courses match</b>Try another search.</div>`;
    $$('[data-enrol]').forEach((b) => (b.onclick = async () => {
      try { const r = await POST(`/api/catalog/${b.dataset.enrol}/enroll`); toast('Enrolled', 'ok'); location.hash = '#/learn/' + r.id; } catch (e) { fail(e); }
    }));
  };
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase().trim(); draw(); };
  draw();
});

// ------------------------------------------------------------ learner: course player
on('/learn/:id', (el, p) => pageLearn(el, p.id), { bare: true });
on('/learn/:id/:mid', (el, p) => pageLearn(el, p.id, p.mid), { bare: true });

async function pageLearn(el, id, mid) {
  const d = await GET('/api/learn/' + id);
  POST(`/api/learn/${id}/start`).catch(() => {});
  if (d.course.type === 'scorm') return scormPlayer(el, d);
  const c = d.course, e = d.enrollment;
  const mods = c.modules;
  const lockedIdx = (i) => c.sequential && mods.slice(0, i).some((m) => !m.done);
  let cur = mods.find((m) => m.id === mid) || mods.find((m, i) => !m.done && !lockedIdx(i)) || mods[0];
  const ci = mods.indexOf(cur);
  if (cur && lockedIdx(ci)) cur = mods.find((m, i) => !m.done) || mods[0];
  el.innerHTML = `<div class="player">
    <aside class="outline">
      <div class="hd"><a href="#/">← My learning</a><h2>${esc(c.title)}</h2>${progress(e.progressPct)}<div style="margin-top:10px">${pill(e.status, e.overdue)} ${e.dueDate ? `<span class="small muted">Due ${fmtDate(e.dueDate)}</span>` : ''}</div></div>
      <ul class="mods">${mods.map((m, i) => {
        const failed = m.type === 'exam' && !m.done && m.exam.maxAttempts && m.exam.attempts.length >= m.exam.maxAttempts;
        return `<li><button data-m="${m.id}" class="${cur && m.id === cur.id ? 'on' : ''}" ${lockedIdx(i) ? 'disabled title="Complete the previous modules first"' : ''}>
          <span class="dot ${m.done ? 'done' : failed ? 'fail' : ''}">${m.done ? '✓' : failed ? '!' : i + 1}</span>
          <span class="mt"><b>${esc(m.title)}</b><span>${{ video: 'Video', text: 'Reading', document: 'Document', link: 'External link', exam: 'Assessment' }[m.type]}${lockedIdx(i) ? ' · 🔒 Locked' : ''}</span></span></button></li>`;
      }).join('')}</ul>
      ${e.status === 'completed' ? `<div style="padding:10px 20px"><div class="note ok">${I('check', 18)}<div><b>Course complete</b><br>${fmtDate(e.completedAt)}${e.certificate ? `<br><a target="_blank" href="${esc(certLink(e.certificate.code))}">View certificate →</a>` : ''}</div></div></div>` : ''}
    </aside>
    <section class="stage"><div class="content" id="stage"></div></section></div>`;
  $$('.mods button').forEach((b) => (b.onclick = () => { location.hash = `#/learn/${id}/${b.dataset.m}`; }));
  if (!cur) { $('#stage').innerHTML = '<div class="empty card"><b>This course has no content yet</b></div>'; return; }
  const next = mods[mods.indexOf(cur) + 1];
  const goNext = () => { location.hash = next ? `#/learn/${id}/${next.id}` : `#/learn/${id}`; if (!next) render(); };
  const complete = async () => {
    try {
      const r = await POST(`/api/learn/${id}/modules/${cur.id}/complete`);
      if (r.status === 'completed' && e.status !== 'completed') toast('🎉 Course complete!', 'ok'); else toast('Module complete', 'ok');
      if (next) location.hash = `#/learn/${id}/${next.id}`; else render();
    } catch (x) { fail(x); }
  };
  const header = `<div class="crumbs">${esc(c.title)} · Module ${mods.indexOf(cur) + 1} of ${mods.length}</div><h1 style="margin-bottom:18px">${esc(cur.title)}</h1>`;
  const doneBar = (label) => cur.done
    ? `<div class="row" style="margin-top:18px"><span class="pill ok">✓ Completed</span>${next ? `<button class="btn primary" id="nx">Next: ${esc(next.title)} →</button>` : ''}</div>`
    : `<div class="row" style="margin-top:18px"><button class="btn primary" id="mc">${label}</button></div>`;
  const st = $('#stage');
  const src = cur.type === 'video' || cur.type === 'document' ? await resolveUrl(cur.url) : cur.url;

  if (cur.type === 'video') {
    st.innerHTML = header + `<div class="video-box"><video id="vid" src="${esc(src)}" preload="metadata" playsinline ${cur.preventSkip ? 'controlsList="nodownload"' : 'controls controlsList="nodownload"'}></video>
      ${cur.preventSkip ? `<div class="vctl"><button id="pp">▶ Play</button><div class="track" id="trk"><i id="wch"></i><b id="thm" style="left:0"></b></div><span class="tm" id="tm">0:00 / 0:00</span><button id="mu">🔊</button></div>` : ''}</div>
      <div class="note ${cur.done ? 'ok' : ''}" id="vh" style="margin-top:14px">${cur.done ? '✓ You have watched this video.' : cur.preventSkip ? '⏳ Watch the whole video to complete this module. Skipping ahead is disabled.' : '⏳ Watch the video to complete this module.'}</div>` + (cur.done && next ? `<div class="row" style="margin-top:14px"><button class="btn primary" id="nx">Next: ${esc(next.title)} →</button></div>` : '');
    const v = $('#vid');
    let maxT = 0, sent = cur.done;
    const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    const finish = () => {
      if (sent) return; sent = true;
      POST(`/api/learn/${id}/modules/${cur.id}/complete`).then((r) => {
        $('#vh').className = 'note ok';
        $('#vh').innerHTML = '✓ Video complete.' + (next ? ` <a href="#/learn/${id}/${next.id}"><b>Continue to ${esc(next.title)} →</b></a>` : '');
        if (r.status === 'completed') toast('🎉 Course complete!', 'ok');
      }).catch(fail);
    };
    v.addEventListener('timeupdate', () => {
      if (!v.isConnected) return;
      if (v.currentTime > maxT && v.currentTime - maxT < 2) maxT = v.currentTime;
      if (cur.preventSkip && v.duration) {
        $('#wch').style.width = (maxT / v.duration) * 100 + '%';
        $('#thm').style.left = (v.currentTime / v.duration) * 100 + '%';
        $('#tm').textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
      }
      if (v.duration && maxT >= v.duration * 0.92) finish();
    });
    v.addEventListener('ended', () => { maxT = v.duration; finish(); });
    if (cur.preventSkip && !cur.done) {
      v.addEventListener('seeking', () => { if (v.currentTime > maxT + 1) { v.currentTime = maxT; toast('Skipping ahead is disabled for this video'); } });
    }
    if (cur.preventSkip) {
      $('#pp').onclick = () => (v.paused ? v.play() : v.pause());
      v.addEventListener('play', () => { if (v.isConnected) $('#pp').textContent = '⏸ Pause'; });
      v.addEventListener('pause', () => { if (v.isConnected) $('#pp').textContent = '▶ Play'; });
      $('#mu').onclick = () => { v.muted = !v.muted; $('#mu').textContent = v.muted ? '🔇' : '🔊'; };
      $('#trk').onclick = (ev) => {
        if (!v.duration) return;
        const r = ev.currentTarget.getBoundingClientRect();
        const t = ((ev.clientX - r.left) / r.width) * v.duration;
        if (cur.done || t <= maxT + 1) v.currentTime = t; else toast('Skipping ahead is disabled for this video');
      };
      if (cur.done) maxT = Infinity;
    }
    S.cleanup.push(() => v.pause());
  } else if (cur.type === 'text') {
    st.innerHTML = header + `<div class="card card-b prose">${md(cur.body)}</div>` + doneBar('Mark as complete');
  } else if (cur.type === 'document') {
    const isPdf = /\.pdf($|\?)/i.test(cur.fileName || cur.url);
    st.innerHTML = header + (isPdf ? `<iframe class="doc-frame" src="${esc(src)}"></iframe>` : `<div class="card card-b"><p>Download and read this document:</p><a class="btn" href="${esc(src)}" download="${esc(cur.fileName || '')}" target="_blank">${I('download')}${esc(cur.fileName || 'Open document')}</a></div>`)
      + `<p class="small muted" style="margin-top:8px"><a href="${esc(src)}" target="_blank">Open in a new tab</a></p>` + doneBar("I've read this document");
  } else if (cur.type === 'link') {
    st.innerHTML = header + `<div class="card card-b"><p>This module is hosted on another site.</p><a class="btn" href="${esc(cur.url)}" target="_blank" rel="noopener">${I('link')}Open ${esc(cur.url)}</a></div>` + doneBar("I've completed this");
  } else if (cur.type === 'exam') {
    const x = cur.exam;
    const used = x.attempts.length;
    const left = x.maxAttempts ? x.maxAttempts - used : Infinity;
    const best = used ? Math.max(...x.attempts.map((a) => a.pct)) : null;
    st.innerHTML = header + `<div class="card"><div class="card-b">
      <div class="grid g4" style="gap:12px;margin-bottom:16px">
        <div><div class="small muted">Questions</div><b style="font-size:18px">${x.questionCount}</b></div>
        <div><div class="small muted">Pass mark</div><b style="font-size:18px">${x.passPct}%</b></div>
        <div><div class="small muted">Time limit</div><b style="font-size:18px">${x.timeLimitMins ? x.timeLimitMins + ' min' : 'None'}</b></div>
        <div><div class="small muted">Attempts</div><b style="font-size:18px">${used}${x.maxAttempts ? ' / ' + x.maxAttempts : ''}</b></div>
      </div>
      ${x.instructions ? `<div class="prose" style="font-size:14px;margin-bottom:12px">${md(x.instructions)}</div>` : ''}
      ${cur.done ? `<div class="note ok">${I('check', 18)}<div><b>Passed</b> with ${best}%.</div></div>`
        : left <= 0 ? `<div class="note bad"><div><b>No attempts left.</b> Your best score was ${best}%. Contact your manager or HR to request another attempt.</div></div>`
        : `<div class="row">${x.openAttemptId ? `<button class="btn primary lg" id="go">Resume attempt →</button>` : `<button class="btn primary lg" id="go">${used ? 'Retake assessment' : 'Start assessment'} →</button>`}
            <span class="muted small">${x.timeLimitMins ? 'The timer starts when you click start and keeps running if you leave. ' : ''}${x.maxAttempts ? `${left} attempt${left === 1 ? '' : 's'} left.` : 'Unlimited attempts.'}</span></div>`}
    </div></div>
    ${used ? `<div class="card" style="margin-top:16px"><div class="card-h"><h3>Your attempts</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Submitted</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody>
      ${x.attempts.map((a) => `<tr><td>${a.attemptNo}</td><td>${fmtDT(a.submittedAt)}</td><td><b>${a.pct}%</b></td><td>${a.passed ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td><td class="actions"><a class="btn sm" href="#/result/${a.id}">Review</a></td></tr>`).join('')}
    </tbody></table></div></div>` : ''}`;
    const go = $('#go');
    if (go) go.onclick = async () => {
      go.disabled = true;
      try { const a = await POST('/api/exam/start', { enrollmentId: id, moduleId: cur.id }); location.hash = '#/exam/' + a.id; } catch (x2) { fail(x2); go.disabled = false; }
    };
  }
  const mc = $('#mc'); if (mc) mc.onclick = complete;
  const nx = $('#nx'); if (nx) nx.onclick = goNext;
}

// ------------------------------------------------------------ SCORM 1.2 / 2004 runtime
function scormPlayer(el, d) {
  const c = d.course, enrId = d.enrollment.id;
  const base = CONTENT + 'scorm/' + c.scorm.dir.replace(/\/$/, '') + '/';
  const items = c.scorm.items;
  let data = d.scormData || {};
  let enr = d.enrollment;
  const keyOf = (href) => String(href).split('?')[0].split('#')[0];
  const statusOf = (href) => {
    const x = data[keyOf(href)] || {};
    return x['cmi.core.lesson_status'] || (x['cmi.success_status'] && x['cmi.success_status'] !== 'unknown' ? x['cmi.success_status'] : x['cmi.completion_status']) || 'not attempted';
  };
  const first = items.find((it) => !['completed', 'passed'].includes(statusOf(it.href))) || items[0];
  el.innerHTML = `<div class="player">
    <aside class="outline">
      <div class="hd"><a href="#/" id="back">← My learning</a><h2>${esc(c.title)}</h2><div id="sp"></div></div>
      <ul class="mods" id="items"></ul>
      <div style="padding:6px 20px" id="done"></div>
      <div style="padding:6px 20px" class="small muted">SCORM ${esc(c.scorm.version || '1.2')} course · progress saves automatically.</div>
    </aside>
    <section class="stage" style="padding:20px"><iframe class="scorm-frame" id="sco" allow="autoplay; fullscreen" allowfullscreen></iframe></section></div>`;
  const frame = $('#sco');
  let current = null;
  const drawOutline = () => {
    $('#sp').innerHTML = progress(enr.progressPct) + `<div style="margin-top:10px">${pill(enr.status, enr.overdue)}${enr.score != null ? ` <span class="small muted">Score ${enr.score}%</span>` : ''}</div>`;
    $('#items').innerHTML = items.map((it, i) => {
      const st = statusOf(it.href);
      const ok = st === 'completed' || st === 'passed', bad = st === 'failed';
      return `<li><button data-h="${esc(it.href)}" class="${current === keyOf(it.href) ? 'on' : ''}"><span class="dot ${ok ? 'done' : bad ? 'fail' : ''}">${ok ? '✓' : bad ? '!' : i + 1}</span><span class="mt"><b>${esc(it.title)}</b><span>${esc(st.replace(/^./, (m) => m.toUpperCase()))}</span></span></button></li>`;
    }).join('');
    $$('#items button').forEach((b) => (b.onclick = () => { frame.src = base + b.dataset.h; }));
    $('#done').innerHTML = enr.status === 'completed' ? `<div class="note ok">${I('check', 18)}<div><b>Course complete</b>${enr.certificate ? `<br><a target="_blank" href="${esc(certLink(enr.certificate.code))}">View certificate →</a>` : ''}</div></div>`
      : enr.status === 'failed' ? `<div class="note bad"><div><b>Assessment not passed.</b> Re-open the assessment to try again.</div></div>` : '';
  };
  const scoFromFrame = () => {
    try {
      const pth = decodeURIComponent(frame.contentWindow.location.pathname);
      const i = pth.indexOf(base);
      if (i >= 0) return pth.slice(i + base.length);
    } catch (e) {}
    return current;
  };
  const nameLF = (() => { const parts = d.learner.name.split(' '); return parts.length > 1 ? parts.slice(-1)[0] + ', ' + parts.slice(0, -1).join(' ') : d.learner.name; })();
  let cmi = {}, dirty = {}, startedAt = Date.now();
  const defaults = () => ({
    'cmi.core._children': 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
    'cmi.core.student_id': d.learner.empId || d.learner.id, 'cmi.core.student_name': nameLF, 'cmi.core.lesson_location': '', 'cmi.core.credit': 'credit',
    'cmi.core.lesson_status': 'not attempted', 'cmi.core.entry': 'ab-initio', 'cmi.core.score._children': 'raw,min,max', 'cmi.core.score.raw': '', 'cmi.core.score.min': '', 'cmi.core.score.max': '',
    'cmi.core.total_time': '0000:00:00', 'cmi.core.lesson_mode': 'normal', 'cmi.suspend_data': '', 'cmi.launch_data': '', 'cmi.comments': '', 'cmi.student_data.mastery_score': '',
    'cmi.learner_id': d.learner.empId || d.learner.id, 'cmi.learner_name': nameLF, 'cmi.location': '', 'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown',
    'cmi.entry': 'ab-initio', 'cmi.mode': 'normal', 'cmi.credit': 'credit', 'cmi.score.raw': '', 'cmi.score.scaled': '', 'cmi.score.min': '', 'cmi.score.max': '', 'cmi.total_time': 'PT0S',
    'cmi.interactions._count': '0', 'cmi.objectives._count': '0',
  });
  let commitTimer = null;
  const commit = (final) => {
    clearTimeout(commitTimer);
    if (!current) return;
    if (!Object.keys(dirty).length && !final) return;
    const payload = JSON.stringify({ sco: current, cmi: dirty });
    dirty = {};
    const req = LOCAL ? api('POST', `/api/scorm/${enrId}/commit`, JSON.parse(payload))
      : fetch(`/api/scorm/${enrId}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).then((r) => r.json());
    return req.then((j) => {
        if (!j.enrollment) return;
        const was = enr.status;
        data = j.scormData; enr = j.enrollment; drawOutline();
        if (enr.status === 'completed' && was !== 'completed') toast('🎉 Course complete!', 'ok');
      }).catch(() => {});
  };
  const init = () => {
    current = scoFromFrame();
    const saved = data[current] || {};
    cmi = { ...defaults(), ...saved };
    if (saved['cmi.core.lesson_status'] && saved['cmi.core.lesson_status'] !== 'not attempted') cmi['cmi.core.entry'] = 'resume';
    if (saved['cmi.completion_status'] && saved['cmi.completion_status'] !== 'unknown') cmi['cmi.entry'] = 'resume';
    startedAt = Date.now();
    drawOutline();
    return 'true';
  };
  const get = (k) => {
    if (k.endsWith('._count')) return cmi[k] || '0';
    return cmi[k] !== undefined ? String(cmi[k]) : '';
  };
  const set = (k, v) => {
    v = String(v);
    cmi[k] = v; dirty[k] = v;
    if (/interactions\.(\d+)\./.test(k)) { const n = +k.match(/interactions\.(\d+)\./)[1] + 1; if (n > +(cmi['cmi.interactions._count'] || 0)) cmi['cmi.interactions._count'] = String(n); }
    if (/status$/.test(k) || /score\.raw$/.test(k)) { clearTimeout(commitTimer); commitTimer = setTimeout(() => commit(), 400); }
    return 'true';
  };
  const API12 = {
    LMSInitialize: init, LMSFinish: () => { commit(true); return 'true'; }, LMSGetValue: get, LMSSetValue: set,
    LMSCommit: () => { commit(); return 'true'; }, LMSGetLastError: () => '0', LMSGetErrorString: () => 'No error', LMSGetDiagnostic: () => '',
  };
  const API2004 = {
    Initialize: init, Terminate: () => { commit(true); return 'true'; }, GetValue: get, SetValue: set,
    Commit: () => { commit(); return 'true'; }, GetLastError: () => '0', GetErrorString: () => 'No error', GetDiagnostic: () => '',
  };
  window.API = API12;
  window.API_1484_11 = API2004;
  frame.addEventListener('load', () => { const s = scoFromFrame(); if (s) { current = s; drawOutline(); } });
  const unload = () => commit(true);
  window.addEventListener('beforeunload', unload);
  S.cleanup.push(() => { commit(true); window.removeEventListener('beforeunload', unload); delete window.API; delete window.API_1484_11; });
  current = keyOf(first.href);
  drawOutline();
  frame.src = base + first.href;
}

// ------------------------------------------------------------ exam taking
on('/exam/:id', async (el, p) => {
  const a = await GET('/api/exam/' + p.id);
  if (a.submittedAt) { location.hash = '#/result/' + a.id; return; }
  const answers = a.answers || {};
  const flags = new Set();
  let idx = Math.max(0, a.questions.findIndex((q) => !answers[q.id] || !answers[q.id].length));
  let submitting = false;
  el.innerHTML = `<div class="exam">
    <div class="exam-top"><div><div class="crumbs">Assessment</div><h2>${esc(a.title)}</h2></div><div class="row">${a.deadline ? `<span class="timer" id="tmr">--:--</span>` : ''}<button class="btn primary" id="sub">Submit</button></div></div>
    <div class="qnav" id="qn"></div>
    <div class="card qcard" id="qc"></div>
    <div class="row between" style="margin-top:14px"><button class="btn" id="prev">← Previous</button><label class="check"><input type="checkbox" id="flag"> Flag for review</label><button class="btn primary" id="next">Next →</button></div>
    <p class="small muted" style="margin-top:18px">Your answers are saved automatically. ${a.deadline ? 'When the timer reaches zero your answers are submitted automatically.' : ''}</p></div>`;
  let saveT;
  const autosave = () => { clearTimeout(saveT); saveT = setTimeout(() => POST(`/api/exam/${a.id}/save`, { answers }).catch(() => {}), 600); };
  const draw = () => {
    const q = a.questions[idx];
    const given = answers[q.id] || [];
    $('#qn').innerHTML = a.questions.map((x, i) => `<button class="${(answers[x.id] || []).length ? 'ans' : ''} ${i === idx ? 'cur' : ''} ${flags.has(x.id) ? 'flag' : ''}" data-i="${i}" title="Question ${i + 1}">${i + 1}</button>`).join('');
    $$('#qn button').forEach((b) => (b.onclick = () => { idx = +b.dataset.i; draw(); }));
    const multi = q.type === 'multi';
    $('#qc').innerHTML = `<div class="row between"><span class="pill brand">Question ${idx + 1} of ${a.questions.length}</span><span class="small muted">${q.type === 'tf' ? 'True / False' : multi ? 'Select all that apply' : 'Choose one answer'} · ${q.points} pt${q.points === 1 ? '' : 's'}</span></div>
      <div class="qt">${esc(q.text)}</div>
      <div class="opts">${q.options.map((o) => `<label class="opt ${given.includes(o.id) ? 'sel' : ''}"><input type="${multi ? 'checkbox' : 'radio'}" name="o" value="${o.id}" ${given.includes(o.id) ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('')}</div>`;
    $$('#qc input').forEach((inp) => (inp.onchange = () => {
      answers[q.id] = $$('#qc input').filter((x) => x.checked).map((x) => x.value);
      $$('#qc .opt').forEach((l) => l.classList.toggle('sel', $('input', l).checked));
      $$('#qn button')[idx].classList.toggle('ans', answers[q.id].length > 0);
      autosave();
    }));
    $('#flag').checked = flags.has(q.id);
    $('#prev').disabled = idx === 0;
    $('#next').textContent = idx === a.questions.length - 1 ? 'Review & submit' : 'Next →';
  };
  $('#flag').onchange = (e) => { const q = a.questions[idx]; e.target.checked ? flags.add(q.id) : flags.delete(q.id); draw(); };
  $('#prev').onclick = () => { if (idx > 0) { idx--; draw(); } };
  $('#next').onclick = () => { if (idx < a.questions.length - 1) { idx++; draw(); } else submit(false); };
  const submit = async (auto) => {
    if (submitting) return;
    if (!auto) {
      const un = a.questions.filter((q) => !(answers[q.id] || []).length).length;
      const ok = await confirmBox(un ? `You have <b>${un} unanswered question${un === 1 ? '' : 's'}</b>. Unanswered questions are marked wrong. Submit anyway?` : 'Submit your answers? You cannot change them afterwards.', 'Submit assessment');
      if (!ok) return;
    }
    submitting = true;
    try { await POST(`/api/exam/${a.id}/submit`, { answers }); location.hash = '#/result/' + a.id; }
    catch (e) { submitting = false; fail(e); }
  };
  $('#sub').onclick = () => submit(false);
  if (a.deadline) {
    const end = Date.parse(a.deadline);
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      const t = $('#tmr'); if (!t) return;
      t.textContent = `${Math.floor(left / 60)}:${('0' + (left % 60)).slice(-2)}`;
      t.classList.toggle('low', left < 60);
      if (left === 0) { toast('Time is up — submitting your answers'); submit(true); }
    };
    tick();
    const iv = setInterval(tick, 1000);
    S.cleanup.push(() => clearInterval(iv));
  }
  const warn = (e) => { if (!submitting) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  S.cleanup.push(() => { window.removeEventListener('beforeunload', warn); clearTimeout(saveT); if (!submitting) POST(`/api/exam/${a.id}/save`, { answers }).catch(() => {}); });
  draw();
}, { bare: true });

on('/result/:id', async (el, p) => {
  const r = await GET('/api/attempts/' + p.id);
  const own = r.user && r.user.id === S.me.id;
  const C = 2 * Math.PI * 64;
  const col = r.passed ? 'var(--ok)' : 'var(--bad)';
  el.innerHTML = `<div class="exam">
    <div class="row between" style="margin-bottom:12px">${own ? `<a href="#/learn/${r.enrollmentId}" class="btn">← Back to course</a>` : `<button class="btn" onclick="history.back()">← Back</button>`}<button class="btn" onclick="print()">${I('print')}Print</button></div>
    <div class="card result-hero">
      <div class="ring"><svg width="150" height="150"><circle cx="75" cy="75" r="64" stroke="var(--line-2)" stroke-width="12" fill="none"/><circle cx="75" cy="75" r="64" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.pct / 100)}"/></svg><div class="lbl">${r.pct}%</div></div>
      <h1>${r.passed ? 'You passed!' : 'Not passed this time'}</h1>
      <p class="muted" style="margin-top:6px">${esc(r.title)} · ${esc(r.courseTitle)}${own ? '' : ' · ' + esc(r.user.name)}</p>
      <div class="row" style="justify-content:center;gap:26px;margin:18px 0 6px">
        <div><div class="small muted">Score</div><b>${r.score} / ${r.maxScore}</b></div>
        <div><div class="small muted">Pass mark</div><b>${r.passPct}%</b></div>
        <div><div class="small muted">Attempt</div><b>#${r.attemptNo}</b></div>
        <div><div class="small muted">Time taken</div><b>${dur(r.durationSec)}</b></div>
        <div><div class="small muted">Submitted</div><b>${fmtDT(r.submittedAt)}</b></div>
      </div>
      ${r.autoSubmitted ? '<p class="small muted">Submitted automatically when time ran out.</p>' : ''}
      <div class="row" style="justify-content:center;margin-top:16px">
        ${r.certificateCode ? `<a class="btn primary lg" target="_blank" href="${esc(certLink(r.certificateCode))}">${I('cert')}View your certificate</a>` : ''}
        ${!r.passed && own ? `<a class="btn primary" href="#/learn/${r.enrollmentId}">Review the material and retry</a>` : ''}
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>Answer review</h3><span class="small muted">${r.review.filter((q) => q.ok).length} of ${r.review.length} correct</span></div>
      ${r.review.map((q, i) => `<div class="review-q"><div class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="pill ${q.ok ? 'ok' : 'bad'}">${q.ok ? '✓' : '✗'} ${i + 1}</span><b style="line-height:1.45">${esc(q.text)}</b></div>
        ${r.reviewMode === 'full' ? `<div class="opts" style="margin:12px 0 0 0">${q.options.map((o) => {
          const chosen = q.given.includes(o.id);
          return `<div class="opt ${o.correct ? 'right' : chosen ? 'wrong' : ''}" style="cursor:default;padding:9px 14px;font-size:14px">${o.correct ? '✓' : chosen ? '✗' : '○'} <span>${esc(o.text)}</span>${chosen ? '<span class="small muted" style="margin-left:auto">your answer</span>' : ''}</div>`;
        }).join('')}</div>${q.explanation ? `<div class="note" style="margin-top:10px">${esc(q.explanation)}</div>` : ''}` : ''}
      </div>`).join('')}
      ${r.reviewMode !== 'full' ? '<div class="card-b small muted">Correct answers are hidden for this assessment.</div>' : ''}
    </div></div>`;
}, { bare: true });

// ------------------------------------------------------------ certificates, transcript, profile
on('/certificates', async (el) => {
  const list = await GET('/api/my/certificates');
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>My certificates</h1><p>Open a certificate to print it or save it as a PDF. Anyone with the ID can verify it.</p></div></div>
    ${list.length ? `<div class="certs">${list.map((c) => `<div class="card certc ${c.status}">
      <div class="row between"><span class="code">${esc(c.code)}</span>${pill(c.status)}</div>
      <h3 style="margin:10px 0 6px">${esc(c.courseTitle)}</h3>
      <div class="small muted">Issued ${fmtDate(c.issuedAt)}${c.expiresAt ? ' · Valid until ' + fmtDate(c.expiresAt) : ' · No expiry'}${c.score != null ? ' · Score ' + c.score + '%' : ''}</div>
      <div class="row" style="margin-top:14px"><a class="btn sm primary" target="_blank" href="${esc(certLink(c.code))}">${I('eye')}View / print</a></div></div>`).join('')}</div>`
    : `<div class="card empty"><b>No certificates yet</b>Complete a course to earn your first certificate.</div>`}</div>`;
}, { nav: '/certificates' });

on('/transcript', async (el) => {
  const t = await GET('/api/my/transcript');
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1>Learning transcript</h1><p>${esc(S.me.name)}${S.me.empId ? ' · ' + esc(S.me.empId) : ''}${S.me.department ? ' · ' + esc(S.me.department) : ''}</p></div><button class="btn no-print" onclick="print()">${I('print')}Print transcript</button></div>
    <div class="card"><div class="card-h"><h3>Courses</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Course</th><th>Status</th><th>Progress</th><th>Score</th><th>Enrolled</th><th>Completed</th><th>Certificate</th></tr></thead><tbody>
    ${t.enrollments.map((e) => `<tr><td class="name"><b><a href="#/learn/${e.id}">${esc(e.course.title)}</a></b><span>${esc(e.course.code || '')}</span></td><td>${pill(e.status, e.overdue)}</td><td style="min-width:120px">${progress(e.progressPct)}</td><td>${e.score != null ? e.score + '%' : '—'}</td><td>${fmtDate(e.enrolledAt)}</td><td>${fmtDate(e.completedAt)}</td><td>${e.certificate ? `<a target="_blank" href="${esc(certLink(e.certificate.code))}">${esc(e.certificate.code)}</a>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No courses yet</td></tr>'}
    </tbody></table></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>Assessment history</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Assessment</th><th>Course</th><th>Attempt</th><th>Date</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody>
    ${t.attempts.map((a) => `<tr><td><b>${esc(a.title)}</b></td><td>${esc(a.courseTitle)}</td><td>#${a.attemptNo}</td><td>${fmtDT(a.submittedAt)}</td><td><b>${a.pct}%</b> <span class="muted small">(${a.score}/${a.maxScore})</span></td><td>${a.passed ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td><td class="actions"><a class="btn sm" href="#/result/${a.id}">Review</a></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No assessments taken yet</td></tr>'}
    </tbody></table></div></div></div>`;
}, { nav: '/transcript' });

on('/profile', async (el) => {
  await loadMe();
  const u = S.me;
  const f = (l, v) => `<div><div class="small muted">${l}</div><b>${esc(v || '—')}</b></div>`;
  el.innerHTML = `<div class="page"><div class="page-head"><div class="row"><div class="avatar" style="width:56px;height:56px;font-size:20px">${esc(initials(u.name))}</div><div><h1>${esc(u.name)}</h1><p>${esc(u.title || '')}${u.department ? ' · ' + esc(u.department) : ''}</p></div></div></div>
    <div class="grid g2"><div class="card"><div class="card-h"><h3>Employee details</h3><span class="small muted">Managed by HR</span></div><div class="card-b grid g2" style="gap:16px">
      ${f('Employee ID', u.empId)}${f('Email', u.email)}${f('Department', u.department)}${f('Job title', u.title)}${f('Location', u.location)}${f('Hire date', u.hireDate ? fmtDate(u.hireDate) : '')}${f('Role', u.role)}${f('Last sign-in', fmtDT(u.lastLoginAt))}
    </div></div>
    <div class="card"><div class="card-h"><h3>Change password</h3></div><form class="card-b" id="cp">
      <div class="field"><label class="f">Current password</label><input type="password" id="c1" required autocomplete="current-password"></div>
      <div class="field"><label class="f">New password</label><input type="password" id="c2" required autocomplete="new-password"><div class="hint">At least ${S.settings.passwordMin} characters</div></div>
      <div class="field"><label class="f">Confirm new password</label><input type="password" id="c3" required autocomplete="new-password"></div>
      <button class="btn primary">Update password</button></form></div></div></div>`;
  $('#cp').onsubmit = async (e) => {
    e.preventDefault();
    try {
      if ($('#c2').value !== $('#c3').value) throw new Error('The new passwords do not match');
      await POST('/api/me/password', { current: $('#c1').value, next: $('#c2').value });
      toast('Password updated', 'ok'); e.target.reset();
    } catch (x) { fail(x); }
  };
}, { nav: '/profile' });

// ------------------------------------------------------------ boot
(async () => {
  try { await loadMe(); } catch (e) { S.me = null; }
  render();
})();
