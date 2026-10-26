#!/usr/bin/env node
/*
 * npm run build: ng build with the version of the client written into it, as the server does
 * (-Dthermobox.version):
 *   1. THERMOBOX_VERSION (GitHub workflows, Docker argument),
 *   2. else the Git tag on the commit being built (26.11.0, 26.11.0-beta.2…),
 *   3. else "dev".
 * The commit (THERMOBOX_COMMIT, GITHUB_SHA or git) is written too. The arguments are passed to
 * ng build: npm run build -- --configuration development
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clientCommit, clientVersion } from './version.mjs';

const v = clientVersion();
const commit = clientCommit();
console.log(`Thermobox client ${v}${commit ? ` (${commit})` : ''}`);

/** ng.js of @angular/cli: node_modules of the project (or of a parent folder). */
function findNg() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    return createRequire(join(root, 'package.json')).resolve('@angular/cli/bin/ng.js');
  } catch {
    const local = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
    return existsSync(local) ? local : null;
  }
}

const ng = findNg();
if (!ng) {
  console.error('\n@angular/cli is not in node_modules: run "npm install" (or "npm ci") first.');
  console.error('With NODE_ENV=production, npm does not install the devDependencies: "npm install --include=dev".\n');
  process.exit(1);
}
const r = spawnSync(
  process.execPath,
  [ng, 'build', '--define', `THERMOBOX_VERSION=${JSON.stringify(v)}`, '--define', `THERMOBOX_COMMIT=${JSON.stringify(commit)}`, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
if (r.error) console.error(r.error);
process.exit(r.status ?? 1);
