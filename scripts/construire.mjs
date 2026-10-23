#!/usr/bin/env node
/*
 * npm run build : ng build avec la version du client inscrite dedans, comme le serveur
 * (-Dthermobox.version) :
 *   1. THERMOBOX_VERSION (workflows GitHub, argument Docker),
 *   2. sinon le tag Git posé sur le commit construit (26.11.0, 26.11.0-beta.2…),
 *   3. sinon « dev ».
 * Le commit (THERMOBOX_COMMIT, GITHUB_SHA ou git) est inscrit aussi. Les arguments sont passés à
 * ng build : npm run build -- --configuration development
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitClient, versionClient } from './version.mjs';

const v = versionClient();
const commit = commitClient();
console.log(`Thermobox client ${v}${commit ? ` (${commit})` : ''}`);

/** ng.js d'@angular/cli : node_modules du projet (ou d'un dossier parent). */
function trouverNg() {
  const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    return createRequire(join(racine, 'package.json')).resolve('@angular/cli/bin/ng.js');
  } catch {
    const local = join(racine, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
    return existsSync(local) ? local : null;
  }
}

const ng = trouverNg();
if (!ng) {
  console.error("\n@angular/cli est introuvable dans node_modules : lancez d'abord « npm install » (ou « npm ci »).");
  console.error('Avec NODE_ENV=production, npm n\'installe pas les devDependencies : « npm install --include=dev ».\n');
  process.exit(1);
}
const r = spawnSync(
  process.execPath,
  [ng, 'build', '--define', `THERMOBOX_VERSION=${JSON.stringify(v)}`, '--define', `THERMOBOX_COMMIT=${JSON.stringify(commit)}`, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
if (r.error) console.error(r.error);
process.exit(r.status ?? 1);
