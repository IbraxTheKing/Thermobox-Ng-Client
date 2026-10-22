#!/usr/bin/env node
// npm run demo: the demo API on :8080 and `ng serve` (which sends /api to it), stopped together.
import { spawn } from 'node:child_process';

const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
const api = spawn(process.execPath, ['mock/serveur-demo.mjs', '--port', '8080'], opts);
const ng = spawn('npx', ['ng', 'serve', '--host', '0.0.0.0'], opts);
const arreter = () => {
  api.kill();
  ng.kill();
  process.exit();
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
api.on('exit', arreter);
ng.on('exit', arreter);
