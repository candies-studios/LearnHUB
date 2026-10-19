#!/usr/bin/env node
'use strict';
/*
 * Seeds LearnHub with the "Chiller SOP and Lockout Process" material:
 *   1. the original SCORM package, imported as-is
 *   2. a native certification course (videos + notes + 15-question exam) built from the same content
 *   3. optional demo employees (--demo) so the dashboards have people in them
 * Usage: node scripts/seed-chiller.js "<path to the chiller and lockout folder>" [--demo]
 */
const path = require('path');
const fs = require('fs');
const { db, save, flush, newId } = require('../lib/db');
const { importScormFromFolder } = require('../lib/scorm');
const C = require('../lib/core');
const { createChillerCertification } = require('../lib/chiller');

const src = process.argv[2];
const demo = process.argv.includes('--demo');
if (!src || !fs.existsSync(path.join(src, 'imsmanifest.xml'))) {
  console.error('Usage: node scripts/seed-chiller.js "<chiller and lockout folder>" [--demo]');
  process.exit(1);
}
const now = new Date().toISOString();
const adminCreated = C.ensureAdmin();
if (adminCreated) console.log('✓ Created admin account', adminCreated);

// 1 ── SCORM package as-is
let scorm = db.courses.find((c) => c.type === 'scorm' && c.title === 'Chiller SOP and Lockout Process');
if (!scorm) {
  const pkg = importScormFromFolder(path.resolve(src));
  scorm = {
    id: newId('crs'), type: 'scorm', code: 'HVAC-SC-01', title: pkg.title,
    description: 'Original SCORM package: Chiller SOP video, Lockout Process video and a 15-question final assessment (90% pass mark). Videos cannot be skipped.',
    category: 'HVAC & Facilities', color: '#5b3cc4', status: 'published', durationMins: 45, selfEnroll: true,
    certificate: { enabled: true, validityMonths: 12 }, modules: [], scorm: { dir: pkg.dir, version: pkg.version, items: pkg.items }, createdAt: now,
  };
  db.courses.push(scorm);
  console.log('✓ Imported SCORM package →', scorm.title);
}
// 2 ── native certification course
const native = createChillerCertification(scorm) || db.courses.find((c) => c.code === 'HVAC-CERT-01');
if (native && native.createdAt >= now) console.log('✓ Created native course →', native.title);

// 3 ── optional demo people
if (demo && !db.users.some((u) => u.email.endsWith('@example.com'))) {
  const mk = (d) => C.createUser({ ...d, password: 'Welcome123!', mustChangePassword: false }).user;
  const mgr = mk({ empId: 'E1001', name: 'Anita Rao', email: 'anita.rao@example.com', department: 'Facilities', title: 'Facilities Manager', location: 'Pune', role: 'manager', hireDate: '2019-06-03' });
  const people = [
    { empId: 'E1002', name: 'Rahul Verma', email: 'rahul.verma@example.com', title: 'HVAC Technician', location: 'Pune', hireDate: '2022-01-10' },
    { empId: 'E1003', name: 'Sneha Kulkarni', email: 'sneha.kulkarni@example.com', title: 'HVAC Technician', location: 'Pune', hireDate: '2023-03-15' },
    { empId: 'E1004', name: 'Imran Shaikh', email: 'imran.shaikh@example.com', title: 'Shift Engineer', location: 'Mumbai', hireDate: '2021-08-23' },
    { empId: 'E1005', name: 'Kavya Nair', email: 'kavya.nair@example.com', title: 'Maintenance Supervisor', location: 'Mumbai', hireDate: '2020-11-02' },
  ].map((p) => mk({ ...p, department: 'Facilities', role: 'employee', managerId: mgr.id }));
  mk({ empId: 'E2001', name: 'Deepak Joshi', email: 'deepak.joshi@example.com', department: 'Human Resources', title: 'HR Business Partner', location: 'Pune', role: 'employee', hireDate: '2018-02-12' });
  const due = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  const admin = db.users.find((u) => u.role === 'admin');
  for (const u of [mgr, ...people]) C.enroll(u.id, native.id, { assignedBy: admin && admin.id, dueDate: due, required: true });
  console.log('✓ Added 6 demo employees (password Welcome123!) and assigned the certification course');
}

save(); flush();
console.log('Done.');
