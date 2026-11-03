#!/usr/bin/env node
/*
 * npm run i18n: the texts of the app, for its translations (src/locale/).
 *
 *   1. ng extract-i18n: the texts marked `i18n` in the templates and `$localize` in TypeScript,
 *      for the build of every platform (docs/platforms.md: each has texts of its own);
 *   2. the texts given to tr() and to the `tr` pipe (texts inside expressions), whose id is
 *      computed here as $localize does;
 *   3. src/locale/en.json updated: {id: {fr, en}}. A new text comes with "en": "" (to write),
 *      a text gone is dropped, a French text changed keeps its old English until rewritten
 *      (listed). The app loads the English texts of en.json (src/locale/en.ts).
 *
 * French is the language of the code; English is the main language of the app (core/i18n.ts).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMsgId } from '@angular/compiler';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'thermobox-i18n-'));
const ng = path.join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const extracted = {};
for (const platform of ['web', 'android', 'ios', 'windows', 'macos', 'linux']) {
  const dir = path.join(out, platform);
  const config = platform === 'web' ? 'production' : `production,${platform}`;
  execFileSync(process.execPath, [ng, 'extract-i18n', '--format', 'json', '--output-path', dir, '--build-target', `Thermobox-Ng-Client:build:${config}`], { cwd: root, stdio: 'inherit' });
  Object.assign(extracted, JSON.parse(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8')).translations);
}

// tr('…') and '…' | tr
const texts = new Map(Object.entries(extracted));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const unescape = (s) => s.replace(/\\\\'/g, "'").replace(/\\'/g, "'").replace(/\\"/g, '"');
for (const f of [...walk(path.join(root, 'src', 'app')), ...walk(path.join(root, 'src', 'platforms'))].filter((f) => /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts'))) {
  // In a template of a .ts file, \\' is a quote escaped in the expression
  const src = fs.readFileSync(f, 'utf8').replace(/\\\\'/g, "\\'");
  for (const m of src.matchAll(/'((?:[^'\\]|\\.)*)'\s*\|\s*tr\b/g)) texts.set(computeMsgId(unescape(m[1]), ''), unescape(m[1]));
  for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) texts.set(computeMsgId(unescape(m[1]), ''), unescape(m[1]));
}

const file = path.join(root, 'src', 'locale', 'en.json');
const old = JSON.parse(fs.readFileSync(file, 'utf8'));
// An English text follows its French text when the id changed (a word changed): matched by text
const byFrench = new Map(Object.values(old).map((v) => [v.fr, v.en]));
const next = {};
const todo = [];
for (const [id, fr] of texts) {
  const en = old[id]?.en || byFrench.get(fr) || '';
  next[id] = { fr, en };
  if (!en) todo.push(fr);
}
fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
fs.rmSync(out, { recursive: true, force: true });
console.log(`${texts.size} texts, ${Object.keys(old).filter((k) => !(k in next)).length} gone, ${todo.length} without English`);
for (const t of todo.slice(0, 50)) console.log('  - ' + t);
