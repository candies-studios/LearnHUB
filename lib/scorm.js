'use strict';
// SCORM 1.2 / 2004 package import: manifest parsing + unpacking into data/content/scorm/<id>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractZip } = require('./zip');
const { CONTENT_DIR } = require('./db');

const SCORM_DIR = path.join(CONTENT_DIR, 'scorm');

function attr(s, n) {
  const m = new RegExp('(?:^|\\s)' + n.replace(':', '\\:') + '\\s*=\\s*"([^"]*)"', 'i').exec(s || '');
  return m ? m[1] : null;
}
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

function parseManifest(xml) {
  const version = decode((/<(?:\w+:)?schemaversion>([^<]+)</i.exec(xml) || [])[1] || '1.2');
  const resources = {};
  const resRe = /<(?:\w+:)?resource\b([^>]*)>/gi;
  let m;
  while ((m = resRe.exec(xml))) {
    const id = attr(m[1], 'identifier');
    if (id) resources[id] = { href: attr(m[1], 'href'), base: attr(m[1], 'xml:base') || '' };
  }
  const orgsTag = /<(?:\w+:)?organizations\b([^>]*)>/i.exec(xml);
  const def = orgsTag ? attr(orgsTag[1], 'default') : null;
  const orgRe = /<(?:\w+:)?organization\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?organization>/gi;
  let org = null;
  while ((m = orgRe.exec(xml))) {
    if (!org || attr(m[1], 'identifier') === def) org = m[2];
    if (attr(m[1], 'identifier') === def) break;
  }
  org = org || '';
  const title = decode((/<(?:\w+:)?title>([\s\S]*?)<\/(?:\w+:)?title>/i.exec(org) || [])[1] || 'SCORM course');
  const items = [];
  const itemRe = /<(?:\w+:)?item\b([^>]*)>\s*<(?:\w+:)?title>([\s\S]*?)<\/(?:\w+:)?title>/gi;
  while ((m = itemRe.exec(org))) {
    const ref = attr(m[1], 'identifierref');
    const r = ref && resources[ref];
    if (r && r.href) {
      items.push({ id: attr(m[1], 'identifier') || ref, title: decode(m[2]), href: (r.base + r.href) + (attr(m[1], 'parameters') || '') });
    }
  }
  if (!items.length) {
    const first = Object.values(resources).find((r) => r.href);
    if (first) items.push({ id: 'item1', title, href: first.base + first.href });
  }
  return { version, title, items };
}

function findManifest(root) {
  // shallowest imsmanifest.xml
  const queue = [''];
  while (queue.length) {
    const rel = queue.shift();
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'imsmanifest.xml')) return rel;
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('__MACOSX')) queue.push(path.join(rel, e.name));
  }
  return null;
}

function finish(id) {
  const root = path.join(SCORM_DIR, id);
  const rel = findManifest(root);
  if (rel === null) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error('No imsmanifest.xml found — is this a SCORM package?');
  }
  const manifest = parseManifest(fs.readFileSync(path.join(root, rel, 'imsmanifest.xml'), 'utf8'));
  if (!manifest.items.length) throw new Error('The manifest has no launchable items');
  return { dir: path.posix.join(id, rel.split(path.sep).join('/')), ...manifest };
}

function importScormFromZip(buf) {
  const id = 'pkg_' + crypto.randomBytes(5).toString('hex');
  extractZip(buf, path.join(SCORM_DIR, id));
  return finish(id);
}

function importScormFromFolder(src) {
  if (!fs.existsSync(path.join(src, 'imsmanifest.xml'))) throw new Error('No imsmanifest.xml in ' + src);
  const id = 'pkg_' + crypto.randomBytes(5).toString('hex');
  fs.cpSync(src, path.join(SCORM_DIR, id), { recursive: true, filter: (s) => path.basename(s) !== '.DS_Store' });
  return finish(id);
}

module.exports = { parseManifest, importScormFromZip, importScormFromFolder };
