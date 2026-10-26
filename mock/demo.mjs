#!/usr/bin/env node
// npm run demo: the demo API on :8080 and `ng serve` (which sends /api to it), stopped together.
import { spawn } from 'node:child_process';

const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
const api = spawn(process.execPath, ['mock/demo-server.mjs', '--port', '8080'], opts);
const ng = spawn('npx', ['ng', 'serve', '--host', '0.0.0.0'], opts);
const stop = () => {
  api.kill();
  ng.kill();
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', stop);
ng.on('exit', stop);
