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
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const FORMAT = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function version() {
  const env = process.env.THERMOBOX_VERSION?.trim();
  if (env) return env.replace(/^v/, '');
  const tags = git('tag', '--points-at', 'HEAD').split('\n').filter((t) => FORMAT.test(t));
  // Plusieurs tags sur le même commit (26.10.2 et 26.10.2-nightly-1) : la stable d'abord
  const stable = tags.find((t) => !t.includes('-'));
  return (stable ?? tags[0] ?? 'dev').replace(/^v/, '');
}

const v = version();
const commit = (process.env.THERMOBOX_COMMIT || process.env.GITHUB_SHA || git('rev-parse', 'HEAD')).slice(0, 7);
console.log(`Thermobox client ${v}${commit ? ` (${commit})` : ''}`);

const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');
const r = spawnSync(
  process.execPath,
  [ng, 'build', '--define', `THERMOBOX_VERSION=${JSON.stringify(v)}`, '--define', `THERMOBOX_COMMIT=${JSON.stringify(commit)}`, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
