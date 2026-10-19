#!/usr/bin/env node
'use strict';
// Usage: node scripts/import-scorm.js "<path to SCORM folder or .zip>"
const fs = require('fs');
const path = require('path');
const { db, save, flush, newId } = require('../lib/db');
const { importScormFromFolder, importScormFromZip } = require('../lib/scorm');

const src = process.argv[2];
if (!src) { console.error('Usage: node scripts/import-scorm.js <folder-or-zip>'); process.exit(1); }
const abs = path.resolve(src);
const pkg = fs.statSync(abs).isDirectory() ? importScormFromFolder(abs) : importScormFromZip(fs.readFileSync(abs));
const c = {
  id: newId('crs'), type: 'scorm', code: '', title: pkg.title, description: 'Imported SCORM ' + pkg.version + ' package.',
  category: 'General', color: '#5b3cc4', status: 'published', durationMins: 30, selfEnroll: true,
  certificate: { enabled: true, validityMonths: 12 }, modules: [], scorm: { dir: pkg.dir, version: pkg.version, items: pkg.items },
  createdAt: new Date().toISOString(),
};
db.courses.push(c);
save(); flush();
console.log(`Imported "${c.title}" with ${pkg.items.length} items → course ${c.id}`);
