/*
 * Version du client, même logique que le serveur ThermoBox : AA.MM.PATCH, éventuellement suivie
 * de -nightly.N, -beta.N, -rc.N (ou -nightly-N), préfixe « v » accepté.
 *   1. THERMOBOX_VERSION (workflows GitHub, argument Docker),
 *   2. sinon le tag Git posé sur le commit (la stable d'abord),
 *   3. sinon « dev ».
 */
import { execFileSync } from 'node:child_process';

export const FORMAT = /^v?(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)[.-]?(\d+)?)?$/;

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function versionClient() {
  const env = process.env.THERMOBOX_VERSION?.trim();
  if (env) return env.replace(/^v/, '');
  const tags = git('tag', '--points-at', 'HEAD').split('\n').filter((t) => FORMAT.test(t));
  const stable = tags.find((t) => !t.includes('-'));
  return (stable ?? tags[0] ?? 'dev').replace(/^v/, '');
}

export function commitClient() {
  return (process.env.THERMOBOX_COMMIT || process.env.GITHUB_SHA || git('rev-parse', 'HEAD')).slice(0, 7);
}

/**
 * versionCode Android (entier croissant d'une version à la suivante, < 2 100 000 000) :
 * ((AA × 100 + MM) × 100 + PATCH) × 1000 + rang, rang = nightly N | alpha 200+N | beta 400+N |
 * rc 600+N | stable 999 : une stable passe après toutes ses prépublications. « dev » : 1.
 */
export function versionCodeAndroid(version) {
  const m = FORMAT.exec(version);
  if (!m) return 1;
  const [, aa, mm, patch, pre, n] = m;
  const base = ((+aa * 100 + +mm) * 100 + +patch) * 1000;
  if (!pre) return base + 999;
  const num = Math.min(n ? +n : 0, 199);
  const decalage = { nightly: 0, alpha: 200, beta: 400, rc: 600 }[pre.toLowerCase()] ?? 0;
  return base + decalage + num;
}
