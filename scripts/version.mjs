/*
 * Version of the client, same logic as the ThermoBox server: YY.MM.PATCH, maybe followed by
 * -nightly.N, -beta.N, -rc.N (or -nightly-N), "v" prefix accepted.
 *   1. THERMOBOX_VERSION (GitHub workflows, Docker argument),
 *   2. else the Git tag on the commit (the stable one first),
 *   3. else "dev".
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

export function clientVersion() {
  const env = process.env.THERMOBOX_VERSION?.trim();
  if (env) return env.replace(/^v/, '');
  const tags = git('tag', '--points-at', 'HEAD').split('\n').filter((t) => FORMAT.test(t));
  const stable = tags.find((t) => !t.includes('-'));
  return (stable ?? tags[0] ?? 'dev').replace(/^v/, '');
}

export function clientCommit() {
  return (process.env.THERMOBOX_COMMIT || process.env.GITHUB_SHA || git('rev-parse', 'HEAD')).slice(0, 7);
}

/**
 * Android versionCode (an integer growing from one version to the next, < 2,100,000,000):
 * ((YY × 100 + MM) × 100 + PATCH) × 1000 + rank, rank = nightly N | alpha 200+N | beta 400+N |
 * rc 600+N | stable 999: a stable comes after all its prereleases. "dev": 1.
 */
export function androidVersionCode(version) {
  const m = FORMAT.exec(version);
  if (!m) return 1;
  const [, yy, mm, patch, pre, n] = m;
  const base = ((+yy * 100 + +mm) * 100 + +patch) * 1000;
  if (!pre) return base + 999;
  const num = Math.min(n ? +n : 0, 199);
  const offset = { nightly: 0, alpha: 200, beta: 400, rc: 600 }[pre.toLowerCase()] ?? 0;
  return base + offset + num;
}
