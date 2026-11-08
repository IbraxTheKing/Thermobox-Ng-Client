#!/usr/bin/env node
/*
 * ThermoBox demo server: the REST API of RestServer (branch dev, 26.12: the English API under
 * /api/v2, the old French one under /api), in memory, with simulated devices.
 *
 * For developing and trying the Angular client without Java, MySQL or boxes:
 *
 *   npm run demo            # this server on :8080 + ng serve (proxy /api → :8080)
 *   node mock/demo-server.mjs [--port 8080] [--app dist/Thermobox-Ng-Client/browser] [--api v2|v1|old]
 *
 * --seed huge: the large set of the server's DBPopulate (10 buildings, 320 rooms, 960 devices,
 * 30 days of measurements every 10 minutes, 500 accounts user001… / user1234, 20 groups).
 *
 * --api: v2 (default) a 26.12 server; v1 a 26.11 server (French API and /api/server only); old a
 * server before 26.11 (French API only).
 *
 * Accounts: admin / admin1234 (ADMIN), gestion / gestion1234 (MANAGER),
 * lecteur / lecteur1234 (VIEWER, limited to « Bâtiment A »).
 *
 * Not the real server: no persistence, simplified rules. The JSON follows the Kotlin DTOs.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { gzipSync, inflateRawSync } from 'node:zlib';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(option('port', process.env.PORT ?? 8080));
const APP = option('app', null);
/** v2: a 26.12 server (both APIs); v1: 26.11 (v1 and /api/server); old: before 26.11 (v1 only). */
const API = option('api', 'v2');

// ================================================================ data

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** demo: the small set; huge: as the server's DBPopulate "huge" (960 devices, 4 million measurements). */
const SEED = option('seed', 'demo');
const MEASURE_STEP = (SEED === 'huge' ? 10 : 15) * MINUTE;
const HISTORY_DAYS = SEED === 'huge' ? 30 : 31;

let nextId = 1;
const id = () => nextId++;

const users = [
  { id: id(), username: 'admin', password: 'admin1234', type: 'ADMIN' },
  { id: id(), username: 'gestion', password: 'gestion1234', type: 'MANAGER' },
  { id: id(), username: 'lecteur', password: 'lecteur1234', type: 'VIEWER' },
  { id: id(), username: 'camille', password: 'camille1234', type: 'VIEWER', firstName: 'Camille', lastName: 'Roux', email: 'camille.roux@exemple.fr' },
  // Imported account, its provisional password not changed yet (26.12)
  { id: id(), username: 'nouveau', password: 'Prov-2026-demo', type: 'VIEWER', firstName: 'Noé', lastName: 'Martin', email: 'noe.martin@exemple.fr', mustChangePassword: true, provisionalExpiresAt: Date.now() + 7 * 24 * 3600 * 1000 },
];

/** Elements: { id, name, kind }, links child → parent (and the children of each, rebuilt on change). */
const elements = [];
const byId = new Map();
const parents = new Map();
let childIndex = null;
const setParent = (childId, parentId) => {
  if (parentId == null) parents.delete(childId);
  else parents.set(childId, parentId);
  childIndex = null;
};
function element(name, kind, parent) {
  const e = { id: id(), name, kind };
  elements.push(e);
  byId.set(e.id, e);
  if (parent) setParent(e.id, parent.id);
  return e;
}
function removeElement(e) {
  elements.splice(elements.indexOf(e), 1);
  byId.delete(e.id);
  for (const [c, p] of [...parents]) if (p === e.id || c === e.id) parents.delete(c);
  childIndex = null;
}

/** Setpoints: { id, type: 'setpoint', value, date (ms), room (element id) }, by element too. */
const setpoints = [];
const setpointsOf = new Map();
function temperature(type, value, date, room) {
  if (type === 'measurement') return addMeasurement(room, value, date);
  const t = { id: id(), type, value: Math.round(value * 10) / 10, date, room };
  setpoints.push(t);
  if (room != null) setpointsOf.set(room, [...(setpointsOf.get(room) ?? []), t]);
  return t;
}

/**
 * Measurements, per device, as columns (millions of them for the huge set): dates and values,
 * NaN for one deleted. Their id: MEASURE_ID + device × 10^5 + index. Those added by hand without
 * a device are kept aside.
 */
const MEASURE_ID = 1e9;
const series = new Map();
const loose = [];
function seriesOf(deviceId) {
  let s = series.get(deviceId);
  if (!s) series.set(deviceId, (s = { t: [], v: [] }));
  return s;
}
function addMeasurement(deviceId, value, date) {
  const v = Math.round(value * 10) / 10;
  if (deviceId == null) {
    const m = { id: id(), type: 'measurement', value: v, date, room: null };
    loose.push(m);
    return m;
  }
  const s = seriesOf(deviceId);
  // Kept in date order (a reading by hand in the past goes to its place)
  let i = s.t.length;
  while (i > 0 && s.t[i - 1] > date) i--;
  s.t.splice(i, 0, date);
  s.v.splice(i, 0, v);
  return { id: MEASURE_ID + deviceId * 1e5 + i, type: 'measurement', value: v, date, room: deviceId };
}
function measurementById(mid) {
  if (mid < MEASURE_ID) return null;
  const deviceId = Math.floor((mid - MEASURE_ID) / 1e5);
  const i = (mid - MEASURE_ID) % 1e5;
  const s = series.get(deviceId);
  return s && i < s.t.length && !Number.isNaN(s.v[i]) ? { s, i, deviceId } : null;
}

const now = Date.now();
const devices = [];
let bldA, bldB, s101, s201, serverRoom;
if (SEED === 'huge') {
  // 10 buildings × 4 floors × 8 rooms × 3 devices, 50 devices not attached, 500 limited accounts, 20 groups
  for (let b = 1; b <= 10; b++) {
    const bld = element(`Bâtiment ${String.fromCharCode(64 + b)}`, 'BUILDING');
    temperature('setpoint', 20 + (b % 3) * 0.5, now - 20 * DAY, bld.id);
    for (let f = 0; f < 4; f++) {
      const fl = element(`Étage ${f}`, 'FLOOR', bld);
      if (f === 3) temperature('setpoint', 19, now - 10 * DAY, fl.id);
      for (let r = 1; r <= 8; r++) {
        const room = element(`Salle ${String.fromCharCode(64 + b)}${f}${String(r).padStart(2, '0')}`, 'ROOM', fl);
        if (r === 8) temperature('setpoint', 17 + (b + f) % 5, now - 5 * DAY, room.id);
        for (let k = 1; k <= 3; k++) devices.push([element(`Boîtier ${room.name.slice(6)}-${k}`, 'DEVICE', room), 17 + ((b * 7 + f * 3 + r + k) % 70) / 10]);
      }
    }
  }
  for (let k = 1; k <= 50; k++) devices.push([element(`Boîtier 0x${(0x4000 + k).toString(16).toUpperCase()}`, 'DEVICE', null), 20]);
  const buildings = elements.filter((e) => e.kind === 'BUILDING');
  for (let u = 1; u <= 500; u++) users.push({ id: id(), username: `user${String(u).padStart(3, '0')}`, password: 'user1234', type: u % 10 === 0 ? 'MANAGER' : 'VIEWER' });
} else {
  bldA = element('Bâtiment A', 'BUILDING');
  const fl1 = element('Étage 1', 'FLOOR', bldA);
  s101 = element('Salle 101', 'ROOM', fl1);
  const s102 = element('Salle 102', 'ROOM', fl1);
  const fl2 = element('Étage 2', 'FLOOR', bldA);
  s201 = element('Amphithéâtre', 'ROOM', fl2);
  const s202 = element('Bibliothèque', 'ROOM', fl2);
  bldB = element('Bâtiment B', 'BUILDING');
  const meeting = element('Salle de réunion', 'ROOM', bldB);
  serverRoom = element('Salle serveurs', 'ROOM', bldB);
  const lobby = element('Accueil', 'ROOM', bldB);
  devices.push(
    [element('Boîtier 101-A', 'DEVICE', s101), 21.2],
    [element('Boîtier 101-B', 'DEVICE', s101), 20.6],
    [element('Boîtier 102', 'DEVICE', s102), 19.1],
    [element('Boîtier amphi nord', 'DEVICE', s201), 22.4],
    [element('Boîtier amphi sud', 'DEVICE', s201), 23.1],
    [element('Boîtier biblio', 'DEVICE', s202), 20.9],
    [element('Boîtier réunion', 'DEVICE', meeting), 21.4],
    [element('Boîtier baie 1', 'DEVICE', serverRoom), 18.4],
    [element('Boîtier baie 2', 'DEVICE', serverRoom), 19.7],
    [element('Boîtier accueil', 'DEVICE', lobby), 17.6],
    [element('Boîtier 0x3F2A', 'DEVICE', null), 20.2],
  );
  temperature('setpoint', 21, now - 40 * DAY, bldA.id);
  temperature('setpoint', 20.5, now - 6 * DAY, bldA.id);
  temperature('setpoint', 21, now - 2 * DAY, bldA.id);
  temperature('setpoint', 21.5, now - 40 * DAY, bldB.id);
  temperature('setpoint', 18, now - 40 * DAY, serverRoom.id);
  temperature('setpoint', 22.5, now - 3 * DAY, s201.id);
}

// The history of each device: a daily cycle around its own level, a slow drift, some noise
const historyStart = Math.floor((now - HISTORY_DAYS * DAY) / MEASURE_STEP) * MEASURE_STEP;
for (const [b, level] of devices) {
  const phase = (b.id * 2.399) % (Math.PI * 2);
  const s = seriesOf(b.id);
  for (let t = historyStart; t <= now; t += MEASURE_STEP) {
    const hour = ((t / HOUR) % 24 + 24) % 24;
    const day = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.9;
    const slow = Math.sin(t / (3 * DAY) + phase) * 0.6;
    s.t.push(t);
    s.v.push(Math.round((level + day + slow + (Math.random() - 0.5) * 0.25) * 10) / 10);
  }
}

// Every 30 s, each device reports
setInterval(() => {
  const t = Date.now();
  for (const [b, level] of devices) {
    const last = lastMeasurement(b.id);
    const target = effectiveSetpoint(parents.get(b.id) ? elementById(parents.get(b.id)) : b)?.setpoint.value ?? level;
    const v = (last?.value ?? level) + (target - (last?.value ?? level)) * 0.04 + (Math.random() - 0.5) * 0.2;
    addMeasurement(b.id, v, t);
  }
}, 30_000).unref();

const favorites = new Map([[1, new Set(SEED === 'huge' ? [] : [s101.id, serverRoom.id])]]);
/** Limited users: user id → granted element ids. Absent: sees everything. */
const restricted = new Map(SEED === 'huge' ? [] : [[3, new Set([bldA.id])], [4, new Set()]]);
const groups = SEED === 'huge' ? [] : [{ id: id(), name: 'Équipe bâtiment B', description: 'Techniciens du bâtiment B', members: new Set([4]), elements: new Set([bldB.id]) }];
if (SEED === 'huge') {
  const buildings = elements.filter((e) => e.kind === 'BUILDING');
  const floors = elements.filter((e) => e.kind === 'FLOOR');
  restricted.set(3, new Set([buildings[0].id]));
  for (const u of users.slice(4)) restricted.set(u.id, new Set([(u.id % 3 ? floors[u.id % floors.length] : buildings[u.id % buildings.length]).id]));
  for (let g = 1; g <= 20; g++) {
    groups.push({ id: id(), name: `Équipe ${g}`, description: `Techniciens du bâtiment ${String.fromCharCode(64 + ((g - 1) % 10) + 1)}`, members: new Set(users.slice(4 + g * 20, 4 + g * 20 + 15).map((u) => u.id)), elements: new Set([buildings[(g - 1) % 10].id]) });
  }
}
const images = new Map();
const settings = { style: 'glass' };
const tokens = new Map();

// ================================================================ hierarchy and climate

const elementById = (i) => byId.get(i) ?? null;
const KIND_ORDER = ['BUILDING', 'FLOOR', 'ROOM', 'DEVICE'];
function byKind(a, b) {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'fr');
}
function childrenOf(p) {
  if (!childIndex) {
    childIndex = new Map();
    for (const e of elements) {
      const pid = parents.get(e.id);
      if (pid == null) continue;
      if (!childIndex.has(pid)) childIndex.set(pid, []);
      childIndex.get(pid).push(e);
    }
    for (const l of childIndex.values()) l.sort(byKind);
  }
  return childIndex.get(p.id) ?? [];
}
function pathOf(e) {
  const r = [];
  let p = parents.get(e.id);
  while (p != null && r.length < 5) {
    const x = elementById(p);
    if (!x) break;
    r.unshift(x);
    p = parents.get(x.id);
  }
  return r;
}
function descendants(e) {
  const r = [];
  const walk = (x, d) => {
    if (d > 5) return;
    for (const c of childrenOf(x)) {
      r.push(c);
      if (c.kind !== 'DEVICE') walk(c, d + 1);
    }
  };
  walk(e, 0);
  return r;
}
const devicesUnder = (e) => (e.kind === 'DEVICE' ? [e] : descendants(e).filter((d) => d.kind === 'DEVICE'));
const PARENTS = { BUILDING: [], FLOOR: ['BUILDING'], ROOM: ['FLOOR', 'BUILDING'], DEVICE: ['ROOM'] };

function lastMeasurement(deviceId) {
  const s = series.get(deviceId);
  if (!s) return null;
  for (let i = s.t.length - 1; i >= 0; i--) if (!Number.isNaN(s.v[i])) return { date: s.t[i], value: s.v[i] };
  return null;
}
const measurements = (e) => devicesUnder(e).map((b) => ({ device: b, measurement: lastMeasurement(b.id) }));
function ownSetpoint(e) {
  let d = null;
  for (const t of setpointsOf.get(e.id) ?? []) if (!d || t.date > d.date) d = t;
  return d;
}
function effectiveSetpoint(e) {
  if (e.kind === 'DEVICE') return null;
  const own = ownSetpoint(e);
  if (own) return { setpoint: own, source: e, inherited: false };
  for (const a of [...pathOf(e)].reverse()) {
    const c = ownSetpoint(a);
    if (c) return { setpoint: c, source: a, inherited: true };
  }
  return null;
}
function ownSetpoints(e) {
  const eff = effectiveSetpoint(e);
  return descendants(e)
    .filter((d) => d.kind === 'FLOOR' || d.kind === 'ROOM')
    .map((d) => ({ d, c: ownSetpoint(d) }))
    .filter((x) => x.c && x.c.date >= (eff?.setpoint.date ?? 0) && x.c.value !== eff?.setpoint.value)
    .map((x) => ({ setpoint: x.c, source: x.d, inherited: false }));
}
/** First index of [t] (sorted) at or after [x]. */
function lowerBound(t, x) {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (t[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}
function history(e, start, end) {
  return devicesUnder(e).map((b) => {
    const s = series.get(b.id) ?? { t: [], v: [] };
    const out = [];
    for (let i = lowerBound(s.t, start); i < s.t.length && s.t[i] <= end; i++) if (!Number.isNaN(s.v[i])) out.push({ date: s.t[i], value: s.v[i] });
    return { device: b, measurements: out };
  });
}
function runningAverage(hs) {
  const dates = [...new Set(hs.flatMap((h) => h.measurements.map((m) => m.date)))].sort((a, b) => a - b);
  const pos = hs.map(() => 0);
  const lastValues = hs.map(() => null);
  return dates.map((d) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i].measurements;
      while (pos[i] < m.length && m[pos[i]].date <= d) lastValues[i] = m[pos[i]++].value;
      if (lastValues[i] != null) (sum += lastValues[i]), n++;
    }
    return { date: d, value: sum / n };
  });
}
/** Largest-Triangle-Three-Buckets, as the server (CurveSampling): at most [n] real points. */
function sample(points, n) {
  if (!n || points.length <= n || n < 3) return points;
  const out = [points[0]];
  const size = (points.length - 2) / (n - 2);
  let a = 0;
  for (let i = 0; i < n - 2; i++) {
    const from = Math.floor((i + 1) * size) + 1;
    const to = Math.min(Math.floor((i + 2) * size) + 1, points.length);
    let ax = 0;
    let ay = 0;
    const nextTo = Math.min(Math.floor((i + 3) * size) + 1, points.length);
    for (let k = to; k < nextTo; k++) (ax += points[k].date), (ay += points[k].value);
    const cnt = Math.max(1, nextTo - to);
    ax /= cnt;
    ay /= cnt;
    let best = from;
    let area = -1;
    for (let k = from; k < to; k++) {
      const s = Math.abs((points[a].date - ax) * (points[k].value - points[a].value) - (points[a].date - points[k].date) * (ay - points[a].value));
      if (s > area) (area = s), (best = k);
    }
    out.push(points[best]);
    a = best;
  }
  out.push(points[points.length - 1]);
  return out;
}

// ================================================================ accesses

function scope(user) {
  if (user.type === 'ADMIN' || !restricted.has(user.id)) return { all: true };
  const granted = new Set(restricted.get(user.id));
  for (const g of groups) if (g.members.has(user.id)) for (const e of g.elements) granted.add(e);
  const accessible = new Set();
  for (const i of granted) {
    const e = elementById(i);
    if (!e) continue;
    accessible.add(e.id);
    for (const d of descendants(e)) accessible.add(d.id);
  }
  const visible = new Set(accessible);
  for (const i of accessible) for (const a of pathOf(elementById(i))) visible.add(a.id);
  return { all: false, accessible, visible };
}
const canSee = (p, e) => !!e && (p.all || p.accessible.has(e.id));
const isVisible = (p, e) => !!e && (p.all || p.visible.has(e.id));
const seesDevices = (u) => u.type === 'ADMIN' || u.type === 'MANAGER';

// ================================================================ JSON

/** LocalDateTime as Jackson writes it by default: an array. */
function dateArray(ms) {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds() * 1e6];
}
/** LocalDateTime as the DTOs write it: "2026-10-21T14:05:00.123". */
function iso(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
const point = (t) => ({ date: iso(t.date), value: Math.round(t.value * 100) / 100 });
const elementDto = (e, accessible = true) => ({ id: e.id, name: e.name, kind: e.kind, accessible });
const setpointDto = (c) => ({ value: c.setpoint.value, date: iso(c.setpoint.date), inherited: c.inherited, sourceId: c.source.id, sourceName: c.source.name });
const localIso = (t) => (t == null ? null : new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 19));
const userDto = (u) => ({
  id: u.id,
  username: u.username,
  type: u.type,
  firstName: u.firstName ?? null,
  lastName: u.lastName ?? null,
  email: u.email ?? null,
  mustChangePassword: !!u.mustChangePassword,
  provisionalExpiresAt: u.mustChangePassword ? localIso(u.provisionalExpiresAt) : null,
});

function node(e, user, p) {
  const parentId = parents.get(e.id) ?? null;
  const attached = parentId != null || e.kind === 'BUILDING';
  const accessible = canSee(p, e) && (e.kind !== 'DEVICE' || seesDevices(user));
  if (!accessible) return { id: e.id, name: e.name, kind: e.kind, parentId, attached, accessible: false, temperature: null, lastMeasurement: null, devices: 0, setpoint: null, image: null, favorite: false };
  const ms = measurements(e);
  const values = ms.map((m) => m.measurement?.value).filter((v) => v != null);
  const c = effectiveSetpoint(e);
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    parentId,
    attached,
    accessible: true,
    temperature: e.kind === 'DEVICE' ? (values[0] ?? null) : values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    lastMeasurement: iso(Math.max(...ms.map((m) => m.measurement?.date ?? -Infinity)) === -Infinity ? null : Math.max(...ms.map((m) => m.measurement?.date ?? -Infinity))),
    devices: seesDevices(user) ? ms.length : 0,
    setpoint: c ? setpointDto(c) : null,
    image: images.get(e.id)?.version ?? null,
    favorite: favorites.get(user.id)?.has(e.id) ?? false,
  };
}

// ================================================================ HTTP

const routes = [];
const route = (method, pattern, role, f) => routes.push({ method, re: new RegExp(`^${pattern.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`), role, f });
// ================================================================ log of the changes (26.12)

/** What the server logs (@Audited), by method and path: [action, target type, id from the path]. */
const AUDITED = [
  ['PUT', /^\/api\/v2\/climate\/(\d+)\/setpoint$/, 'setpoint.set', 'element'],
  ['POST', /^\/api\/v2\/hierarchy\/elements$/, 'element.create', 'element'],
  ['PUT', /^\/api\/v2\/hierarchy\/elements\/(\d+)$/, 'element.update', 'element'],
  ['PUT', /^\/api\/v2\/hierarchy\/elements\/(\d+)\/parent$/, 'element.move', 'element'],
  ['DELETE', /^\/api\/v2\/rooms\/(\d+)$/, 'element.delete', 'element'],
  ['PUT', /^\/api\/v2\/rooms\/(\d+)\/image$/, 'element.image', 'element'],
  ['DELETE', /^\/api\/v2\/rooms\/(\d+)\/image$/, 'element.image-delete', 'element'],
  ['POST', /^\/api\/v2\/users$/, 'user.create', 'user'],
  ['PUT', /^\/api\/v2\/users\/(\d+)$/, 'user.update', 'user'],
  ['DELETE', /^\/api\/v2\/users\/(\d+)$/, 'user.delete', 'user'],
  ['PUT', /^\/api\/v2\/users\/(\d+)\/access$/, 'user.access', 'user'],
  ['POST', /^\/api\/v2\/users\/(\d+)\/provisional-password$/, 'user.provisional-password', 'user'],
  ['POST', /^\/api\/v2\/groups$/, 'group.create', 'group'],
  ['PUT', /^\/api\/v2\/groups\/(\d+)$/, 'group.update', 'group'],
  ['DELETE', /^\/api\/v2\/groups\/(\d+)$/, 'group.delete', 'group'],
  ['POST', /^\/api\/v2\/alerts\/channels$/, 'channel.create', 'channel'],
  ['PUT', /^\/api\/v2\/alerts\/channels\/(\d+)$/, 'channel.update', 'channel'],
  ['PUT', /^\/api\/v2\/alerts\/channels\/(\d+)\/enabled$/, 'channel.enable', 'channel'],
  ['DELETE', /^\/api\/v2\/alerts\/channels\/(\d+)$/, 'channel.delete', 'channel'],
  ['POST', /^\/api\/v2\/alerts\/rules$/, 'rule.create', 'rule'],
  ['PUT', /^\/api\/v2\/alerts\/rules\/(\d+)$/, 'rule.update', 'rule'],
  ['PUT', /^\/api\/v2\/alerts\/rules\/(\d+)\/enabled$/, 'rule.enable', 'rule'],
  ['DELETE', /^\/api\/v2\/alerts\/rules\/(\d+)$/, 'rule.delete', 'rule'],
  ['PUT', /^\/api\/v2\/server\/logo$/, 'logo.set', ''],
  ['DELETE', /^\/api\/v2\/server\/logo$/, 'logo.reset', ''],
  ['PUT', /^\/api\/v2\/server\/limits$/, 'limits.set', ''],
  ['DELETE', /^\/api\/v2\/server\/limits$/, 'limits.reset', ''],
  ['PUT', /^\/api\/v2\/server\/name$/, 'name.set', ''],
  ['DELETE', /^\/api\/v2\/server\/name$/, 'name.reset', ''],
  ['PUT', /^\/api\/v2\/settings$/, 'style.set', ''],
  ['POST', /^\/api\/v2\/auth\/password$/, 'account.password', ''],
  ['PUT', /^\/api\/v2\/audit\/settings$/, 'audit.retention', ''],
];
const auditLog = [];
let auditRetention = 90;
const SECRET_KEY = /password|secret|token|authorization|url|hash|key/i;
const withoutSecrets = (v) =>
  Array.isArray(v) ? v.map(withoutSecrets)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !SECRET_KEY.test(k) || x != null).map(([k, x]) => [k, SECRET_KEY.test(k) ? '•••' : withoutSecrets(x)]))
      : v;
function audited(method, path, ctx, res) {
  const a = AUDITED.find(([m, re]) => m === method && re.test(path));
  if (!a) return;
  const [, re, action, type] = a;
  const id = +(re.exec(path)?.[1] ?? res?.body?.id ?? NaN);
  const target = Number.isFinite(id) && type ? id : null;
  const name = target == null ? null
    : type === 'element' ? elements.find((e) => e.id === target)?.name ?? res?.body?.name
      : type === 'user' ? users.find((u) => u.id === target)?.username
        : type === 'group' ? (typeof groups !== 'undefined' ? groups.find((g) => g.id === target)?.name : null)
          : res?.body?.name ?? null;
  const element = type === 'element' && target != null ? elements.find((e) => e.id === target) : null;
  const changes = (() => { try { const b = json(ctx.body); return b == null ? undefined : withoutSecrets(b); } catch { return undefined; } })();
  auditLog.push({ id: auditLog.length + 1, at: iso(Date.now()), userId: ctx.user.id, username: ctx.user.username, role: ctx.user.type, action, targetType: type || null, targetId: target,
    targetName: name ?? null, details: { ...(changes !== undefined ? { changes } : {}), ...(element ? { place: pathOf(element).map((e) => e.name).join(' › ') || undefined } : {}) } });
}
route('GET', '/api/v2/audit', 'ADMIN', ({ q }) => {
  const offset = +(q.get('offset') ?? 0), limit = +(q.get('limit') ?? 50);
  const user = q.get('user'), action = q.get('action'), text = (q.get('q') ?? '').toLowerCase(), from = q.get('from') ? Date.parse(q.get('from')) : null;
  const rows = auditLog.filter((e) =>
    (!user || e.userId === +user) && (!action || (action.includes('.') ? e.action === action : e.action.startsWith(action + '.'))) &&
    (!from || Date.parse(e.at) >= from) && (!text || [e.username, e.targetName ?? '', JSON.stringify(e.details)].join(' ').toLowerCase().includes(text))).reverse();
  return ok({ total: rows.length, entries: rows.slice(offset, offset + limit) });
});
route('GET', '/api/v2/audit/users', 'ADMIN', () => ok([...new Map(auditLog.filter((e) => e.userId != null).map((e) => [e.userId, e.username])).entries()].map(([id, username]) => ({ id, username })).sort((a, b) => a.username.localeCompare(b.username))));
route('GET', '/api/v2/audit/settings', 'ADMIN', () => ok({ retentionDays: auditRetention }));
route('PUT', '/api/v2/audit/settings', 'ADMIN', ({ body }) => {
  const d = json(body)?.retentionDays ?? null;
  if (d != null && !(d >= 1 && d <= 3650)) return error(400, 'retentionDays: from 1 to 3650 days, or null to keep them for good');
  auditRetention = d;
  return ok({ retentionDays: d });
});



const ok = (body, status = 200) => ({ status, body });
const empty = (status = 204) => ({ status });
const error = (status, message) => ({ status, body: { error: message } });

function readBody(req) {
  return new Promise((r) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => r(Buffer.concat(chunks)));
  });
}
const json = (b) => {
  try {
    return b.length ? JSON.parse(b.toString('utf8')) : null;
  } catch {
    return null;
  }
};
/** ?points=N (26.12): at most N points per curve, 1000 by default, 0 for all; false when invalid. A server before 26.12 sends every point. */
const pointsOf = (q) => {
  if (API !== 'v2') return 0;
  const raw = q.get('points');
  if (raw == null || raw === '') return 1000;
  const n = Number(raw);
  return n === 0 || (Number.isInteger(n) && n >= 3 && n <= 10000) ? n : false;
};
const period = (q) => {
  const start = Date.parse(q.get('start') ?? '');
  const end = Date.parse(q.get('end') ?? '');
  return isNaN(start) || isNaN(end) || start >= end ? null : [start, end];
};

// ---- auth
route('POST', '/api/v2/auth/login', 'public', ({ body }) => {
  const c = json(body) ?? {};
  if (!c.username || !c.password) return error(400, 'username and password are required');
  const u = users.find((x) => x.username === String(c.username).trim() && x.password === c.password);
  if (!u) return error(401, 'Invalid username or password');
  if (u.mustChangePassword && u.provisionalExpiresAt && u.provisionalExpiresAt < Date.now()) {
    return { status: 401, body: { error: 'Provisional password expired: ask an administrator for a new one', code: 'provisional_expired' } };
  }
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 8 * HOUR).toISOString();
  tokens.set(token, { userId: u.id, expiresAt });
  return ok({ token, tokenType: 'Bearer', expiresAt, user: userDto(u) });
});
route('POST', '/api/v2/auth/logout', 'auth', ({ token }) => (tokens.delete(token), empty()));
route('GET', '/api/v2/auth/me', 'auth', ({ user }) => ok(userDto(user)));
route('GET', '/api/v2/auth/password-policy', 'public', () => ok({ minLength: 10, maxBytes: 72, letter: true, digit: true, notUsername: true }));
route('POST', '/api/v2/auth/password', 'auth', ({ body, user }) => {
  const c = json(body) ?? {};
  if (!c.currentPassword || !c.newPassword) return error(400, 'currentPassword and newPassword are required');
  if (c.currentPassword !== user.password) return { status: 403, body: { error: 'The current password is wrong', code: 'wrong_password' } };
  const p = String(c.newPassword);
  const problems = [];
  if (p.length < 10) problems.push('too_short');
  if (!/\p{L}/u.test(p)) problems.push('no_letter');
  if (!/\d/.test(p)) problems.push('no_digit');
  if (user.username.length >= 3 && p.toLowerCase().includes(user.username.toLowerCase())) problems.push('contains_username');
  if (p === user.password) problems.push('same_as_current');
  if (problems.length) return { status: 400, body: { error: 'The new password is refused', code: 'password_refused', problems } };
  user.password = p;
  user.mustChangePassword = false;
  user.provisionalExpiresAt = null;
  return empty();
});

// ---- provisional passwords and import of accounts (26.12)
const PROV_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function provisionalPassword() {
  for (;;) {
    const b = randomBytes(12);
    const t = [...b].map((x) => PROV_ALPHABET[x % PROV_ALPHABET.length]).join('');
    if (/\d/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t)) return t.match(/.{4}/g).join('-');
  }
}
route('POST', '/api/v2/users/{id}/provisional-password', 'ADMIN', ({ p, q }) => {
  const u = users.find((x) => x.id === +p.id);
  if (!u) return empty(404);
  const days = Math.min(90, Math.max(1, Number(q.get('days')) || 7));
  u.password = provisionalPassword();
  u.mustChangePassword = true;
  u.provisionalExpiresAt = Date.now() + days * 24 * 3600 * 1000;
  return ok({ id: u.id, username: u.username, password: u.password, expiresAt: localIso(u.provisionalExpiresAt) });
});

/** Minimal reading of .xlsx (first sheet, shared and inline texts) for the demo. */
function readXlsx(buf) {
  const files = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Object.assign(new Error('Not an Excel workbook (.xlsx).'), { code: 'not_xlsx' });
  let at = buf.readUInt32LE(end + 16);
  const n = buf.readUInt16LE(end + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data).toString('utf8') : data.toString('utf8'));
    at += 46 + nameLen + extra + comment;
  }
  const unxml = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const sheet = files.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw Object.assign(new Error('The workbook has no sheet.'), { code: 'not_xlsx' });
  const col = (r) => [...r.replace(/\d/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
  let number = 0;
  return [...sheet.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)].map((row) => {
    number = Number(/r="(\d+)"/.exec(row[1])?.[1]) || number + 1;
    const line = [];
    line.number = number;
    for (const c of row[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = /t="(\w+)"/.exec(c[2])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1] ?? '';
      const text = t === 's' ? shared[+v] : t === 'inlineStr' ? unxml([...(c[3] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')) : unxml(v);
      line[col(c[1])] = text ?? '';
    }
    return Object.assign(Array.from(line, (x) => x ?? ''), { number });
  });
}
function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === sep) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  rows.forEach((r, i) => (r.number = i + 1));
  return rows.filter((r) => r.some((x) => x.trim()));
}
const IMPORT_HEADERS = {
  USERNAME: ['identifiant', 'login', 'username', 'user', 'utilisateur', 'compte', 'uid'],
  FIRST_NAME: ['prenom', 'firstname', 'givenname', 'first'],
  LAST_NAME: ['nom', 'lastname', 'surname', 'familyname', 'nomdefamille', 'last', 'name'],
  EMAIL: ['email', 'mail', 'courriel', 'adressemail', 'adresseemail', 'emailaddress'],
  ROLE: ['role', 'type', 'profil', 'droit', 'droits'],
};
const letters = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}+/gu, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-zA-Z]/g, '');
const importSessions = new Map();
function openImport(user, source, rows) {
  if (!rows.length) return { status: 400, body: { error: 'Empty list', code: 'empty' } };
  const columns = rows[0].map((c, i) => String(c).trim() || `Colonne ${i + 1}`);
  // Each line keeps its number in the file (empty lines counted)
  const data = rows
    .slice(1)
    .map((r, i) => Object.assign(columns.map((_, c) => String(r[c] ?? '').trim()), { number: r.number ?? i + 2 }))
    .filter((r) => r.some(Boolean));
  if (!data.length) return { status: 400, body: { error: 'No line under the names of the columns', code: 'empty' } };
  const sid = randomBytes(18).toString('base64url');
  importSessions.set(sid, { owner: user.id, source, columns, rows: data });
  const sample = data.slice(0, 5).map((r) => [...r]);
  const suggested = {};
  for (const [field, names] of Object.entries(IMPORT_HEADERS)) {
    const c = columns.find((x) => names.includes(letters(x).toLowerCase()) && !Object.values(suggested).includes(x));
    if (c) suggested[field] = c;
  }
  return ok({ id: sid, source, columns, sample, rowCount: data.length, suggested });
}
const roleOf = (t) => {
  const k = letters(t).toLowerCase();
  if (['admin', 'administrateur', 'administratrice', 'administrator'].includes(k)) return 'ADMIN';
  if (['manager', 'gestionnaire', 'gestion', 'responsable'].includes(k)) return 'MANAGER';
  if (['viewer', 'lecteur', 'lectrice', 'lecture', 'observateur', 'utilisateur', 'user', 'employe'].includes(k)) return 'VIEWER';
  return null;
};
function planImport(s, o) {
  const takenNames = new Set(users.map((u) => u.username.toLowerCase()));
  const takenMails = new Set(users.map((u) => u.email?.toLowerCase()).filter(Boolean));
  const fileNames = new Set(), fileMails = new Set();
  const idx = Object.fromEntries(Object.entries(o.mapping ?? {}).map(([f, c]) => [f, s.columns.indexOf(c)]).filter(([, i]) => i >= 0));
  const cell = (r, f) => (idx[f] != null ? r[idx[f]] : '') || null;
  return s.rows.map((r, i) => {
    const problems = [];
    let dup = false;
    const first = cell(r, 'FIRST_NAME'), last = cell(r, 'LAST_NAME'), email = cell(r, 'EMAIL');
    if (email) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(email)) problems.push('email_invalid');
      else if (takenMails.has(email.toLowerCase())) problems.push('email_taken'), (dup = true);
      else if (fileMails.has(email.toLowerCase())) problems.push('email_repeated'), (dup = true);
    }
    const roleText = cell(r, 'ROLE');
    const role = roleText ? roleOf(roleText) : o.defaultRole ?? 'VIEWER';
    if (!role) problems.push('role_unknown');
    let username = null, made = false, adjusted = false;
    const given = cell(r, 'USERNAME');
    if (given) {
      const clean = letters(given);
      if (!clean || /\d/.test(given)) problems.push('username_invalid');
      else if (takenNames.has(clean.toLowerCase())) problems.push('username_taken'), (dup = true), (username = clean);
      else if (fileNames.has(clean.toLowerCase())) problems.push('username_repeated'), (dup = true), (username = clean);
      else (username = clean), (adjusted = clean !== given);
    } else {
      const f = letters(first).toLowerCase(), l = letters(last).toLowerCase();
      const base = f && l ? f[0] + l : f + l;
      if (base) {
        const free = (x) => !takenNames.has(x) && !fileNames.has(x);
        username = [base, f + l, ...'abcdefghijklmnopqrstuvwxyz'.split('').map((x) => base + x)].find(free) ?? null;
        made = !!username;
      }
      if (!username) problems.push('username_missing');
    }
    const status = problems.some((p) => !/taken|repeated/.test(p)) ? 'INVALID' : dup ? 'DUPLICATE' : 'CREATE';
    if (status === 'CREATE') fileNames.add(username.toLowerCase()), email && fileMails.add(email.toLowerCase());
    return { line: r.number ?? i + 2, username, firstName: first, lastName: last, email, role: role ?? o.defaultRole ?? 'VIEWER', status, problems, usernameMade: made, usernameAdjusted: adjusted };
  });
}
route('GET', '/api/v2/users/import/sources', 'ADMIN', () => ok([{ name: 'Annuaire RH (démo)' }]));
route('POST', '/api/v2/users/import/file', 'ADMIN', ({ body, q, user }) => {
  const name = (q.get('name') ?? 'liste').toLowerCase();
  if (!body.length) return { status: 400, body: { error: 'Missing file', code: 'empty' } };
  if (body.length > 10 * 1024 * 1024) return { status: 413, body: { error: 'The file is too large.', code: 'too_large' } };
  if (name.endsWith('.xls') || body[0] === 0xd0) return { status: 400, body: { error: 'Old Excel format', code: 'xls' } };
  try {
    const rows = body[0] === 0x50 && body[1] === 0x4b ? readXlsx(body) : readCsv(body.toString('utf8'));
    return openImport(user, q.get('name') ?? 'liste', rows);
  } catch (e) {
    return { status: 400, body: { error: e.message, code: e.code ?? 'not_xlsx' } };
  }
});
route('POST', '/api/v2/users/import/source', 'ADMIN', ({ body, user }) => {
  const c = json(body) ?? {};
  if (c.name !== 'Annuaire RH (démo)') return { status: 400, body: { error: 'No such source.', code: 'unknown_source' } };
  const people = [['prenom', 'nom', 'mail', 'service']];
  const firsts = ['Léa', 'Hugo', 'Chloé', 'Lucas', 'Inès', 'Jules', 'Manon', 'Louis', 'Zoé', 'Adam', 'Jade', 'Léo'];
  const lasts = ['Bernard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand'];
  for (let i = 0; i < 24; i++) people.push([firsts[i % 12], lasts[(i * 5) % 12], `${letters(firsts[i % 12]).toLowerCase()}.${letters(lasts[(i * 5) % 12]).toLowerCase()}@exemple.fr`, ['Accueil', 'Maintenance', 'Direction'][i % 3]]);
  return openImport(user, c.name, people);
});
route('POST', '/api/v2/users/import/{sid}/check', 'ADMIN', ({ p, body, user }) => {
  const s = importSessions.get(p.sid);
  if (!s || s.owner !== user.id) return { status: 404, body: { error: 'This import is no longer open', code: 'import_expired' } };
  const rows = planImport(s, json(body) ?? {});
  return ok({ rows, create: rows.filter((r) => r.status === 'CREATE').length, duplicates: rows.filter((r) => r.status === 'DUPLICATE').length, invalid: rows.filter((r) => r.status === 'INVALID').length });
});
route('POST', '/api/v2/users/import/{sid}/confirm', 'ADMIN', ({ p, body, user }) => {
  const s = importSessions.get(p.sid);
  if (!s || s.owner !== user.id) return { status: 404, body: { error: 'This import is no longer open', code: 'import_expired' } };
  importSessions.delete(p.sid);
  const o = json(body) ?? {};
  const rows = planImport(s, o);
  const expires = Date.now() + Math.min(90, Math.max(1, o.validityDays ?? 7)) * 24 * 3600 * 1000;
  const created = [];
  for (const r of rows.filter((x) => x.status === 'CREATE')) {
    const u = { id: id(), username: r.username, password: provisionalPassword(), type: r.role, firstName: r.firstName, lastName: r.lastName, email: r.email, mustChangePassword: true, provisionalExpiresAt: expires };
    users.push(u);
    restricted.set(u.id, new Set());
    created.push({ line: r.line, id: u.id, username: u.username, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.type, password: u.password, expiresAt: localIso(expires) });
  }
  return ok({ created, skipped: rows.filter((r) => r.status !== 'CREATE'), failed: [] });
});
route('DELETE', '/api/v2/users/import/{sid}', 'ADMIN', ({ p }) => (importSessions.delete(p.sid), empty()));

// ---- users
route('GET', '/api/v2/users', 'ADMIN', () => ok(users.map(userDto)));
route('POST', '/api/v2/users', 'public', ({ body }) => {
  const c = json(body) ?? {};
  const username = String(c.username ?? '').trim();
  if (!username || !c.password) return error(400, 'username and password are required');
  if (users.some((u) => u.username === username)) return error(409, 'Username already taken');
  const u = { id: id(), username, password: c.password, type: 'VIEWER' };
  users.push(u);
  restricted.set(u.id, new Set());
  return empty(201);
});
route('GET', '/api/v2/users/username/{name}', 'ADMIN', ({ p }) => {
  const u = users.find((x) => x.username === decodeURIComponent(p.name));
  return u ? ok(userDto(u)) : empty(404);
});
route('GET', '/api/v2/users/{id}', 'owner', ({ p }) => {
  const u = users.find((x) => x.id === +p.id);
  return u ? ok(userDto(u)) : empty(404);
});
route('PUT', '/api/v2/users/{id}', 'owner', ({ p, body, user }) => {
  const u = users.find((x) => x.id === +p.id);
  if (!u) return empty(404);
  const c = json(body) ?? {};
  if (c.type && c.type !== u.type && user.type !== 'ADMIN') return error(403, 'Only an admin can change a role');
  const name = c.username?.trim();
  if (name && name !== u.username) {
    if (users.some((x) => x.username === name)) return error(409, 'Username already taken');
    u.username = name;
  }
  if (c.password) u.password = c.password;
  if (c.type) u.type = c.type;
  if (typeof c.email === 'string' && c.email.trim()) {
    const m = c.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(m)) return error(400, 'Invalid email address');
    if (users.some((x) => x !== u && x.email?.toLowerCase() === m.toLowerCase())) return error(409, 'Email address already used');
  }
  for (const k of ['firstName', 'lastName', 'email']) if (typeof c[k] === 'string') u[k] = c[k].trim() || null;
  return ok(userDto(u));
});
route('DELETE', '/api/v2/users/{id}', 'owner', ({ p }) => {
  const i = users.findIndex((x) => x.id === +p.id);
  if (i < 0) return empty(404);
  users.splice(i, 1);
  return empty();
});
const accessDto = (u) => {
  const isRestricted = u.type !== 'ADMIN' && restricted.has(u.id);
  return { restricted: isRestricted, elements: isRestricted ? [...restricted.get(u.id)].map(elementById).filter(Boolean).map((e) => ({ id: e.id, name: e.name, kind: e.kind })) : [] };
};
route('GET', '/api/v2/users/{id}/access', 'owner', ({ p }) => {
  const u = users.find((x) => x.id === +p.id);
  return u ? ok(accessDto(u)) : empty(404);
});
route('PUT', '/api/v2/users/{id}/access', 'ADMIN', ({ p, body }) => {
  const u = users.find((x) => x.id === +p.id);
  if (!u) return empty(404);
  const c = json(body) ?? {};
  if (u.type === 'ADMIN') return error(400, 'An ADMIN always sees everything');
  if (c.restricted === false) restricted.delete(u.id);
  else restricted.set(u.id, new Set(c.elements ?? []));
  return ok(accessDto(u));
});

// ---- groups
const groupDto = (g) => ({
  id: g.id,
  name: g.name,
  description: g.description,
  members: [...g.members].map((m) => users.find((u) => u.id === m)).filter(Boolean).map((u) => ({ id: u.id, username: u.username })),
  elements: [...g.elements].map(elementById).filter(Boolean).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
});
route('GET', '/api/v2/groups', 'ADMIN', () => ok(groups.map(groupDto)));
route('GET', '/api/v2/groups/{id}', 'ADMIN', ({ p }) => {
  const g = groups.find((x) => x.id === +p.id);
  return g ? ok(groupDto(g)) : empty(404);
});
function saveGroup(g, c) {
  const name = String(c?.name ?? '').trim();
  if (!name) return error(400, 'The name of the group is required');
  if (groups.some((x) => x !== g && x.name === name)) return error(400, `The name "${name}" is already used`);
  const target = g ?? { id: id() };
  Object.assign(target, { name, description: c.description ?? null, members: new Set(c.members ?? []), elements: new Set(c.elements ?? []) });
  if (!g) groups.push(target);
  return ok(groupDto(target), g ? 200 : 201);
}
route('POST', '/api/v2/groups', 'ADMIN', ({ body }) => saveGroup(null, json(body)));
route('PUT', '/api/v2/groups/{id}', 'ADMIN', ({ p, body }) => {
  const g = groups.find((x) => x.id === +p.id);
  return g ? saveGroup(g, json(body)) : empty(404);
});
route('DELETE', '/api/v2/groups/{id}', 'ADMIN', ({ p }) => {
  const i = groups.findIndex((x) => x.id === +p.id);
  if (i >= 0) groups.splice(i, 1);
  return empty();
});

// ---- rooms (without kind) and photos
route('GET', '/api/v2/rooms', 'auth', ({ scopeOf }) => ok(elements.filter((e) => canSee(scopeOf, e)).map((e) => ({ id: e.id, name: e.name }))));
route('DELETE', '/api/v2/rooms/{id}', 'ADMIN', ({ p }) => {
  const e = elementById(+p.id);
  if (!e) return empty();
  removeElement(e);
  series.delete(e.id);
  setpointsOf.delete(e.id);
  for (let i = setpoints.length - 1; i >= 0; i--) if (setpoints[i].room === e.id) setpoints.splice(i, 1);
  images.delete(e.id);
  return empty();
});
route('GET', '/api/v2/rooms/{id}/image', 'auth', ({ p, scopeOf }) => {
  const e = elementById(+p.id);
  const img = e && canSee(scopeOf, e) ? images.get(e.id) : null;
  return img ? { status: 200, raw: img.data, type: img.type, headers: { ETag: `"${img.version}"`, 'Cache-Control': 'private, no-cache' } } : empty(404);
});
route('PUT', '/api/v2/rooms/{id}/image', 'ADMIN', ({ p, body, req }) => {
  const e = elementById(+p.id);
  if (!e) return empty(404);
  if (!body.length) return error(400, 'The file is empty.');
  if (body.length > 10 * 1024 * 1024) return error(400, 'The image must not exceed 10 MB.');
  const version = Date.now();
  images.set(e.id, { data: body, type: req.headers['content-type'] || 'image/jpeg', version });
  return ok({ image: version });
});
route('DELETE', '/api/v2/rooms/{id}/image', 'ADMIN', ({ p }) => (images.delete(+p.id), empty()));

// ---- hierarchy
route('GET', '/api/v2/hierarchy/tree', 'auth', ({ user, scopeOf }) =>
  ok({
    all: scopeOf.all,
    devicesVisible: seesDevices(user),
    nodes: [...elements].filter((e) => isVisible(scopeOf, e) && (e.kind !== 'DEVICE' || seesDevices(user))).sort(byKind).map((e) => node(e, user, scopeOf)),
  }),
);
route('GET', '/api/v2/hierarchy/elements/{id}', 'auth', ({ p, user, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e || !canSee(scopeOf, e) || (e.kind === 'DEVICE' && !seesDevices(user))) return empty(404);
  const container = e.kind === 'FLOOR' || e.kind === 'BUILDING';
  return ok({
    element: node(e, user, scopeOf),
    ancestors: pathOf(e).map((a) => elementDto(a, canSee(scopeOf, a))),
    children: e.kind === 'DEVICE' ? [] : childrenOf(e).filter((c) => c.kind !== 'DEVICE' || seesDevices(user)).map((c) => elementDto(c, canSee(scopeOf, c))),
    measurements: seesDevices(user) ? measurements(e).map((m) => ({ id: m.device.id, name: m.device.name, value: m.measurement?.value ?? null, date: iso(m.measurement?.date) })) : [],
    ownSetpoints: e.kind === 'DEVICE' ? [] : ownSetpoints(e).map(setpointDto),
    rooms: container ? descendants(e).filter((d) => d.kind === 'ROOM').sort(byKind).map((s) => node(s, user, scopeOf)) : [],
  });
});
function place(e, parentId) {
  if (parentId == null) {
    setParent(e.id, null);
    return null;
  }
  const parent = elementById(parentId);
  if (!parent) return error(400, `Unknown parent ${parentId}`);
  if (!PARENTS[e.kind].includes(parent.kind)) return error(400, `${e.kind} cannot go into ${parent.kind}`);
  if (descendants(e).some((d) => d.id === parent.id) || parent.id === e.id) return error(400, 'An element cannot go into what it contains');
  setParent(e.id, parent.id);
  return null;
}
route('POST', '/api/v2/hierarchy/elements', 'ADMIN', ({ body, user, scopeOf }) => {
  const c = json(body) ?? {};
  if (!KIND_ORDER.includes(c.kind)) return error(400, 'kind must be one of BUILDING, FLOOR, ROOM, DEVICE');
  if (!String(c.name ?? '').trim()) return error(400, 'name is required');
  const e = { id: id(), name: c.name.trim(), kind: c.kind };
  const refusal = place(e, c.parentId ?? null);
  if (refusal) return refusal;
  elements.push(e);
  byId.set(e.id, e);
  childIndex = null;
  return ok(node(e, user, scopeOf), 201);
});
route('PUT', '/api/v2/hierarchy/elements/{id}', 'ADMIN', ({ p, body, user, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e) return empty(404);
  const c = json(body) ?? {};
  if (!String(c.name ?? '').trim()) return error(400, 'name is required');
  const refusal = place(e, c.parentId ?? null);
  if (refusal) return refusal;
  e.name = c.name.trim();
  return ok(node(e, user, scopeOf));
});
route('PUT', '/api/v2/hierarchy/elements/{id}/parent', 'ADMIN', ({ p, body, user, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e) return empty(404);
  const refusal = place(e, json(body)?.parentId ?? null);
  return refusal ?? ok(node(e, user, scopeOf));
});

// ---- climate
route('GET', '/api/v2/climate/{id}/history', 'auth', ({ p, q, user, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e || !canSee(scopeOf, e)) return empty(404);
  const per = period(q);
  if (!per) return error(400, 'start and end must be ISO-8601 instants, start before end');
  const [start, end] = per;
  const hs = history(e, start, end);
  const c = effectiveSetpoint(e);
  const points = pointsOf(q);
  if (points === false) return error(400, 'points must be 0 (every point) or between 3 and 10000');
  const curve = (l) => sample(l, points).map(point);
  const setpoints = c ? (setpointsOf.get(c.source.id) ?? []).filter((t) => t.date <= end) : [];
  // The one in force at the start, then those of the period
  const before = setpoints.filter((t) => t.date < start).sort((a, b) => b.date - a.date)[0];
  const periodSetpoints = [...(before ? [{ ...before, date: start }] : []), ...setpoints.filter((t) => t.date >= start)].sort((a, b) => a.date - b.date);
  const container = e.kind === 'FLOOR' || e.kind === 'BUILDING';
  return ok({
    devices: container || !seesDevices(user) ? [] : hs.map((h) => ({ id: h.device.id, name: h.device.name, points: curve(h.measurements) })),
    rooms: container
      ? descendants(e)
          .filter((d) => d.kind === 'ROOM')
          .sort(byKind)
          .map((s) => {
            const ids = new Set(devicesUnder(s).map((b) => b.id));
            return { id: s.id, name: s.name, points: curve(runningAverage(hs.filter((h) => ids.has(h.device.id)))) };
          })
          .filter((s) => s.points.length)
      : [],
    average: curve(runningAverage(hs)),
    setpoints: periodSetpoints.map(point),
  });
});
route('GET', '/api/v2/climate/averages', 'auth', ({ q, scopeOf }) => {
  const per = period(q);
  if (!per) return error(400, 'start and end must be ISO-8601 instants, start before end');
  const points = pointsOf(q);
  if (points === false) return error(400, 'points must be 0 (every point) or between 3 and 10000');
  const ids = [...new Set((q.get('ids') ?? '').split(',').map(Number).filter(Boolean))];
  if (ids.length > 200) return error(400, 'At most 200 ids per request');
  const r = {};
  for (const i of ids) {
    const e = elementById(i);
    if (e && canSee(scopeOf, e)) r[i] = sample(runningAverage(history(e, per[0], per[1])), points).map(point);
  }
  return ok(r);
});
// ThermoBox 26.12: the rooms that started or stopped respecting their setpoint (SetpointWatch of the server)
const WATCH = { threshold: 0.5, hold: 10 * 60_000, lookback: 3600_000, back: 15 * 60_000, maxBack: 6 * 3600_000 };
function watchState(t, sp) {
  const d = t - sp;
  return d <= -WATCH.threshold ? 'HEATING' : d >= WATCH.threshold ? 'TOO_HOT' : 'STABLE';
}
function watchChanges(curve, sp, since, now) {
  const out = [];
  let confirmed = null;
  let cand = null;
  let start = 0;
  let last = 0;
  const confirm = () => {
    // Given in the period in which it became known (start + hold), as the server
    const known = start + WATCH.hold;
    if (confirmed && confirmed !== cand && known > since && known <= now) out.push({ previous: confirmed, state: cand, at: start, temperature: last });
    confirmed = cand;
  };
  for (const t of curve) {
    const s = watchState(t.value, sp);
    if (s !== cand) (cand = s), (start = t.date);
    last = t.value;
    if (cand !== confirmed && t.date - start >= WATCH.hold) confirm();
  }
  if (cand && cand !== confirmed && now - start >= WATCH.hold) confirm();
  return out;
}
route('GET', '/api/v2/notifications/setpoints', 'auth', ({ q, scopeOf }) => {
  const now = Date.now();
  const raw = q.get('since');
  let since = raw ? new Date(raw).getTime() : now - WATCH.back;
  if (Number.isNaN(since)) return error(400, 'since must be a date-time (ISO-8601)');
  since = Math.min(now, Math.max(now - WATCH.maxBack, since));
  const ids = q.get('ids') ? [...new Set(q.get('ids').split(',').map(Number).filter(Boolean))] : null;
  const picked = ids ? ids.map(elementById).filter(Boolean).flatMap((e) => (e.kind === 'ROOM' ? [e] : descendants(e).filter((d) => d.kind === 'ROOM'))) : elements.filter((e) => e.kind === 'ROOM');
  const events = [];
  for (const room of new Set(picked)) {
    if (!canSee(scopeOf, room)) continue;
    const sp = effectiveSetpoint(room)?.setpoint.value;
    if (sp == null) continue;
    const curve = runningAverage(history(room, since - WATCH.lookback, now));
    for (const c of watchChanges(curve, sp, since, now)) {
      events.push({
        roomId: room.id,
        name: room.name,
        place: pathOf(room).map((a) => a.name).join(' › '),
        state: c.state,
        previous: c.previous,
        temperature: Math.round(c.temperature * 100) / 100,
        setpoint: sp,
        at: iso(c.at),
      });
    }
  }
  events.sort((a, b) => (a.at < b.at ? -1 : 1));
  return ok({ since: iso(since), now: iso(now), events });
});
route('PUT', '/api/v2/climate/{id}/setpoint', 'MANAGER', ({ p, body, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e || !canSee(scopeOf, e)) return empty(404);
  if (e.kind === 'DEVICE') return error(400, 'A setpoint is set on a building, a floor or a room');
  const c = json(body) ?? {};
  if (typeof c.value !== 'number') return error(400, 'value is required');
  const { min, max } = limits.setpoint;
  if (c.value < min || c.value > max) return error(400, `Setpoint out of range: ${c.value} °C (from ${min} to ${max} °C)`);
  const propres = ownSetpoints(e);
  const date = Date.now();
  temperature('setpoint', c.value, date, e.id);
  const replaced = [];
  if (c.force) for (const x of propres) (temperature('setpoint', c.value, date, x.source.id), replaced.push(elementDto(x.source)));
  const keep = c.force ? new Set() : new Set(propres.flatMap((x) => [x.source.id, ...descendants(x.source).map((d) => d.id)]));
  return ok({
    kept: c.force ? [] : propres.map(setpointDto),
    replaced,
    devices: devicesUnder(e).filter((b) => !keep.has(b.id)).map((b) => elementDto(b)),
    failures: [],
  });
});

// ---- favourites
route('GET', '/api/v2/favorites', 'auth', ({ user, scopeOf }) => ok([...(favorites.get(user.id) ?? [])].filter((i) => canSee(scopeOf, elementById(i)))));
route('PUT', '/api/v2/favorites/{id}', 'auth', ({ p, user, scopeOf }) => {
  const e = elementById(+p.id);
  if (!e || !canSee(scopeOf, e)) return empty(404);
  if (e.kind !== 'ROOM') return error(400, 'Only a room can be a favorite');
  if (!favorites.has(user.id)) favorites.set(user.id, new Set());
  favorites.get(user.id).add(e.id);
  return empty();
});
route('DELETE', '/api/v2/favorites/{id}', 'auth', ({ p, user }) => (favorites.get(user.id)?.delete(+p.id), empty()));

// ---- temperatures (entities: dates as Jackson arrays), a page at a time since 26.12
const temperatureDto = (t) => ({ id: t.id, value: t.value, date: dateArray(t.date) });
/**
 * The temperatures of [type] ('setpoint', 'measurement' or null for both) the user may see, the
 * latest first, from [offset]: merged from the end of each device's column, never all at once.
 */
function* latestFirst(type, scopeOf) {
  const sources = [];
  if (type !== 'measurement') sources.push({ list: [...setpoints, ...(type == null ? [] : [])].filter((t) => canSee(scopeOf, elementById(t.room))).sort((a, b) => a.date - b.date), kind: 'list' });
  if (type !== 'setpoint') {
    sources.push({ list: [...loose].sort((a, b) => a.date - b.date), kind: 'list' });
    for (const [deviceId, col] of series) if (canSee(scopeOf, elementById(deviceId))) sources.push({ col, deviceId, kind: 'col' });
  }
  // A heap on the date of the next one of each source (from its end)
  const heap = [];
  const date = (h) => (h.src.kind === 'col' ? h.src.col.t[h.i] : h.src.list[h.i].date);
  const push = (h) => {
    heap.push(h);
    let k = heap.length - 1;
    while (k > 0) {
      const pk = (k - 1) >> 1;
      if (date(heap[pk]) >= date(heap[k])) break;
      [heap[pk], heap[k]] = [heap[k], heap[pk]];
      k = pk;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && date(heap[l]) > date(heap[m])) m = l;
        if (r < heap.length && date(heap[r]) > date(heap[m])) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const src of sources) {
    const n = src.kind === 'col' ? src.col.t.length : src.list.length;
    if (n) push({ src, i: n - 1 });
  }
  while (heap.length) {
    const h = pop();
    if (h.src.kind === 'col') {
      if (!Number.isNaN(h.src.col.v[h.i])) yield { id: MEASURE_ID + h.src.deviceId * 1e5 + h.i, value: h.src.col.v[h.i], date: h.src.col.t[h.i] };
    } else yield h.src.list[h.i];
    if (h.i > 0) push({ src: h.src, i: h.i - 1 });
  }
}
function countOf(type, scopeOf) {
  let n = 0;
  if (type !== 'measurement') n += setpoints.filter((t) => canSee(scopeOf, elementById(t.room))).length;
  if (type !== 'setpoint') {
    n += loose.length;
    for (const [deviceId, col] of series) if (canSee(scopeOf, elementById(deviceId))) n += col.v.reduce((a, v) => a + (Number.isNaN(v) ? 0 : 1), 0);
  }
  return n;
}
function temperaturePage(type, q, scopeOf) {
  // Before 26.12: every temperature in one answer
  if (API !== 'v2') return ok([...latestFirst(type, scopeOf)].map(temperatureDto));
  const limit = q.get('limit') == null ? 1000 : Number(q.get('limit'));
  const offset = q.get('offset') == null ? 0 : Number(q.get('offset'));
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= 10000 && Number.isInteger(offset) && offset >= 0)) return error(400, 'limit must be between 1 and 10000, offset at least 0');
  const out = [];
  let k = 0;
  for (const t of latestFirst(type, scopeOf)) {
    if (k++ < offset) continue;
    out.push(temperatureDto(t));
    if (out.length >= limit) break;
  }
  const r = ok(out);
  if (scopeOf.all && offset === 0) r.headers = { 'X-Total-Count': String(countOf(type, scopeOf)) };
  return r;
}
route('GET', '/api/v2/temperatures', 'auth', ({ q, scopeOf }) => temperaturePage(null, q, scopeOf));
route('GET', '/api/v2/temperatures/type/{type}', 'auth', ({ p, q, scopeOf }) => {
  if (!['setpoint', 'measurement'].includes(p.type)) return empty(204);
  return temperaturePage(p.type, q, scopeOf);
});
route('POST', '/api/v2/temperatures/type/{type}', 'ADMIN', ({ p, body }) => {
  const c = json(body) ?? {};
  if (!['setpoint', 'measurement'].includes(p.type)) return empty(404);
  if (typeof c.value !== 'number') return error(400, 'value is required');
  temperature(p.type, c.value, c.date ? Date.parse(c.date) : Date.now(), null);
  return empty(201);
});
const parseDateBody = (d) => (Array.isArray(d) ? new Date(d[0], d[1] - 1, d[2], d[3] ?? 0, d[4] ?? 0).getTime() : Date.parse(d));
route('PUT', '/api/v2/temperatures/{id}', 'ADMIN', ({ p, body }) => {
  const c = json(body) ?? {};
  const m = measurementById(+p.id);
  if (m) {
    if (typeof c.value === 'number') m.s.v[m.i] = c.value;
    if (c.date) {
      const value = m.s.v[m.i];
      m.s.v[m.i] = NaN;
      addMeasurement(m.deviceId, value, parseDateBody(c.date));
    }
    return empty();
  }
  const t = setpoints.find((x) => x.id === +p.id) ?? loose.find((x) => x.id === +p.id);
  if (t) {
    if (typeof c.value === 'number') t.value = c.value;
    if (c.date) t.date = parseDateBody(c.date);
  }
  return empty();
});
route('DELETE', '/api/v2/temperatures/{id}', 'ADMIN', ({ p }) => {
  const m = measurementById(+p.id);
  if (m) m.s.v[m.i] = NaN;
  for (const list of [setpoints, loose]) {
    const i = list.findIndex((x) => x.id === +p.id);
    if (i >= 0) {
      const [t] = list.splice(i, 1);
      if (t.room != null) setpointsOf.set(t.room, (setpointsOf.get(t.room) ?? []).filter((x) => x !== t));
    }
  }
  return empty();
});

// ---- updates (a corrective is out)
const patchVersion = {
  version: '26.10.3',
  type: 'PATCH',
  typeLabel: 'Patch',
  recommended: true,
  prerelease: false,
  channel: 'stable',
  older: false,
  title: '26.10.3',
  publishedAt: new Date(now - 2 * DAY).toISOString(),
  url: 'https://github.com/IbraxTheKing/ThermoBox/releases',
  notes: '## Fixes\n- Inherited setpoints show in **Manage**\n- MQTT devices: reconnect after a broker outage\n\nSee https://github.com/IbraxTheKing/ThermoBox/pull/52',
  migration: null,
  incompatible: false,
  blockedBy: null,
};
const updateState = {
  component: 'REST',
  installedVersion: '26.10.2',
  channel: 'STABLE',
  dailyCheck: true,
  lastCheck: new Date(now - 3 * HOUR).toISOString(),
  error: null,
  updateAvailable: true,
  latestPatch: patchVersion,
  latestFeature: null,
  available: [patchVersion],
  olderVersions: [],
  automaticInstall: false,
  installMode: 'Demo server: nothing is installed.',
  installation: null,
  // 26.12: what the notes of the installed version say about going back
  installedRollback: true,
  installedNotes: '## Corrections\n- Consignes héritées dans **Gérer**\n\nRétrocompatibilité : oui',
};
route('GET', '/api/v2/updates', 'auth', ({ user }) => ok(user.type === 'ADMIN' ? updateState : { ...updateState, error: null, automaticInstall: null, installMode: null, installation: null }));
route('POST', '/api/v2/updates/check', 'ADMIN', () => ok({ ...updateState, lastCheck: new Date().toISOString() }));
route('GET', '/api/v2/updates/{version}', 'ADMIN', ({ p }) =>
  p.version === patchVersion.version
    ? ok({
        version: patchVersion,
        installedVersion: '26.10.2',
        installable: false,
        checks: [
          { level: 'OK', title: 'Same monthly series', detail: 'Fixes only: the database is not changed.' },
          { level: 'BLOCKING', title: 'Automatic installation impossible', detail: 'Demo server.' },
        ],
        backupRequired: false,
        simpleRollback: true,
        confirmationRequired: false,
      })
    : { status: 404, body: { status: 404, message: `Unknown version: ${p.version}` } },
);

// ---- settings
route('GET', '/api/v2/settings', 'auth', () => ok(settings));
route('PUT', '/api/v2/settings', 'ADMIN', ({ body }) => {
  const s = json(body)?.style;
  if (!['glass', 'panel'].includes(s)) return error(400, 'style must be one of glass, panel');
  settings.style = s;
  return ok(settings);
});

// ---- the server itself (26.12): name, version, logo, temperature limits
const SERVER_VERSION = API === 'v2' ? '26.12.0' : '26.11.0';
const DEFAULT_LIMITS = { measurement: { min: -10, max: 50 }, setpoint: { min: -10, max: 50 } };
let limits = structuredClone(DEFAULT_LIMITS);
const DEFAULT_LOGO = await readFile(new URL('../public/icons/icon-512.png', import.meta.url)).catch(() => null);
let logo = null;
const logoVersion = () => (logo ? String(logo.version) : 'default');
const serverInfo = () =>
  API === 'v2'
    ? { name: 'ThermoBox', version: SERVER_VERSION, apiVersions: ['v1', 'v2'], logo: `/api/v2/server/logo?v=${logoVersion()}`, logoSource: logo ? 'custom' : 'default', features: ['user-import', 'provisional-passwords'] }
    : { name: 'ThermoBox', version: SERVER_VERSION, apiVersions: ['v1'] };
route('GET', '/api/v2/server', 'public', () => ok(serverInfo()));
route('GET', '/api/v2/server/logo', 'public', () => {
  const l = logo ?? (DEFAULT_LOGO && { data: DEFAULT_LOGO, type: 'image/png' });
  return l ? { status: 200, raw: l.data, type: l.type, headers: { 'Cache-Control': 'public, max-age=300', ETag: `"${logoVersion()}"` } } : empty(404);
});
route('PUT', '/api/v2/server/logo', 'ADMIN', ({ body, req }) => {
  const type = String(req.headers['content-type'] ?? '').split(';')[0];
  if (!body.length) return error(400, 'The image is empty');
  if (body.length > 5 * 1024 * 1024) return error(400, 'The logo must not exceed 5 MB');
  if (!/^image\/(png|jpeg|gif|svg\+xml)$/.test(type)) return error(400, 'The logo must be a PNG, JPEG, GIF or SVG image');
  logo = { data: body, type, version: Date.now() };
  return ok(serverInfo());
});
route('DELETE', '/api/v2/server/logo', 'ADMIN', () => ((logo = null), ok(serverInfo())));
route('GET', '/api/v2/server/limits', 'auth', () => ok(limits));
// What this process uses (26.12, ADMIN): the figures of Node, as the server gives those of its JVM
let cpuBefore = { usage: process.cpuUsage(), at: process.hrtime.bigint() };
let gcCount = 0;
let gcTimeMs = 0;
route('GET', '/api/v2/server/metrics', 'ADMIN', () => {
  const now = process.hrtime.bigint();
  const usage = process.cpuUsage();
  const elapsedUs = Number(now - cpuBefore.at) / 1000;
  const used = usage.user - cpuBefore.usage.user + usage.system - cpuBefore.usage.system;
  const cpus = os.cpus().length;
  cpuBefore = { usage, at: now };
  const mem = process.memoryUsage();
  const load = os.loadavg()[0] / cpus;
  // A collection now and then, a few milliseconds each
  if (Math.random() < 0.4) (gcCount++, (gcTimeMs += Math.round(2 + Math.random() * 12)));
  const mb = (b) => Math.round(b / 1048576);
  return ok({
    processCpu: Math.round(Math.min(100, (used / elapsedUs / cpus) * 100) * 10) / 10,
    systemCpu: Math.round(Math.min(100, load * 100) * 10) / 10,
    processors: cpus,
    heapUsedMb: mb(mem.heapUsed),
    heapCommittedMb: mb(mem.heapTotal),
    heapMaxMb: 768,
    nonHeapUsedMb: mb(mem.rss - mem.heapTotal),
    threads: 18 + Math.round(Math.random() * 6),
    gcCount,
    gcTimeMs,
    uptimeSeconds: Math.round(process.uptime()),
  });
});
route('PUT', '/api/v2/server/limits', 'ADMIN', ({ body }) => {
  const c = json(body) ?? {};
  const next = structuredClone(limits);
  for (const k of ['measurement', 'setpoint']) {
    for (const b of ['min', 'max']) if (typeof c[k]?.[b] === 'number') next[k][b] = c[k][b];
    const r = next[k];
    if (!(r.min < r.max)) return error(400, `${k}: min must be lower than max`);
    if (r.min < -100 || r.max > 200) return error(400, `${k}: limits must stay between -100.0 and 200.0 °C`);
  }
  limits = next;
  return ok(limits);
});
route('DELETE', '/api/v2/server/limits', 'ADMIN', () => ((limits = structuredClone(DEFAULT_LIMITS)), ok(limits)));

// ---- temperature alerts (26.12, ADMIN): channels, rules, alerts in progress. Nothing is sent:
// a test of a channel is SENT, unless its address says "fail".
const alertChannels = [];
const alertRules = [];
const alertDeliveries = [];
const channelView = (c) => ({
  id: c.id, name: c.name, kind: c.kind, enabled: c.enabled,
  email: c.kind === 'EMAIL' ? { host: c.host, port: c.port, security: c.security, username: c.username ?? null, passwordSet: !!c.password, from: c.from, fromName: c.fromName ?? null, recipients: c.recipients, template: c.template ?? null } : null,
  webhook: c.kind === 'WEBHOOK' ? { format: c.format, urlPreview: c.url ? `${new URL(c.url).origin}/…` : null, urlSet: !!c.url, authorizationSet: !!c.authorization, signingSecretSet: !!c.signingSecret, template: c.template ?? null } : null,
  secretUnreadable: false, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
});
const ruleView = (r) => ({
  ...r,
  scope: r.scope.map((i) => ({ id: i, name: byId.get(i)?.name ?? null, kind: byId.get(i)?.kind ?? null })),
  channels: r.channels.map((i) => { const c = alertChannels.find((x) => x.id === i); return { id: i, name: c?.name ?? null, kind: c?.kind ?? null }; }),
  createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
});
/** AlertService.build: the same checks, the same messages. */
function alertChannel(b, current) {
  const name = String(b.name ?? '').trim();
  if (!name || name.length > 100) throw new Error('name: 1 to 100 characters');
  const kind = current?.kind ?? String(b.kind ?? '').toUpperCase();
  if (!['EMAIL', 'WEBHOOK'].includes(kind)) throw new Error('kind: EMAIL or WEBHOOK');
  if (current && b.kind && b.kind !== current.kind) throw new Error('kind cannot change: create another channel');
  const keep = (v, old) => (v == null ? old : v === '' ? null : v);
  const c = { ...(current ?? { id: id(), createdAt: Date.now() }), name, kind, enabled: b.enabled ?? true, updatedAt: Date.now() };
  if (kind === 'EMAIL') {
    const e = b.email ?? {};
    if (!e.host?.trim()) throw new Error('host: the name or address of the SMTP server');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(e.from ?? '')) throw new Error('from: a valid email address');
    const to = [...new Set((e.recipients ?? []).map((x) => x.trim()).filter(Boolean))];
    if (!to.length) throw new Error('recipients: at least one address');
    Object.assign(c, { host: e.host.trim(), port: e.port ?? 587, security: e.security ?? 'STARTTLS', username: e.username?.trim() || null, password: keep(e.password, current?.password), from: e.from.trim(), fromName: e.fromName?.trim() || null, recipients: to, template: e.template?.trim() ? e.template : null });
  } else {
    const w = b.webhook ?? {};
    const url = keep(w.url?.trim(), current?.url);
    if (!url) throw new Error('url: the address of the webhook');
    if (w.url != null && !/^https:\/\//i.test(url)) throw new Error('The URL must start with https://');
    Object.assign(c, { format: w.format ?? 'GENERIC', url, authorization: keep(w.authorization, current?.authorization), signingSecret: keep(w.signingSecret, current?.signingSecret), template: w.template?.trim() ? w.template : null });
  }
  return c;
}
function alertRule(b, current) {
  const name = String(b.name ?? '').trim();
  if (!name || name.length > 100) throw new Error('name: 1 to 100 characters');
  if (!(b.tolerance >= 0 && b.tolerance <= 20)) throw new Error('tolerance: 0 to 20 °C above the setpoint');
  for (const k of ['minDurationSeconds', 'clearAfterSeconds']) if (!(b[k] >= 0 && b[k] <= 21600)) throw new Error(`${k}: 0 to 21600 (6 h)`);
  if (b.reminderSeconds && !(b.reminderSeconds >= 300 && b.reminderSeconds <= 604800)) throw new Error('reminderSeconds: 0 (no reminder), or 300 (5 min) to 604800 (7 days)');
  const scope = b.global ? [] : [...new Set(b.scope ?? [])];
  if (!b.global && !scope.length) throw new Error('scope: at least one building, floor or room (or global: true)');
  for (const s of scope) if (!byId.has(s)) throw new Error(`scope: unknown element ${s}`);
  const channels = [...new Set(b.channels ?? [])];
  for (const c of channels) if (!alertChannels.some((x) => x.id === c)) throw new Error(`channels: unknown channel ${c}`);
  return { ...(current ?? { id: id(), createdAt: Date.now() }), name, enabled: b.enabled ?? true, tolerance: b.tolerance, minDurationSeconds: b.minDurationSeconds, clearAfterSeconds: b.clearAfterSeconds, reminderSeconds: b.reminderSeconds ?? 0, notifyResolution: b.notifyResolution ?? true, global: !!b.global, scope, channels, updatedAt: Date.now() };
}
const alertCall = (f) => { try { return f(); } catch (e) { return error(400, e.message); } };
const alertStatus = () => ({ enabled: true, running: true, lastRun: iso(Date.now() - 12_000), watchedRooms: alertRules.some((r) => r.enabled) ? elements.filter((e) => e.kind === 'ROOM').length : 0, lastError: null, runByAnotherServer: false });
const alertsRoute = (method, path, f) => API === 'v2' && route(method, `/api/v2/alerts${path}`, 'ADMIN', f);
alertsRoute('GET', '', () => ok({ status: alertStatus(), channels: alertChannels.map(channelView), rules: alertRules.map(ruleView), active: [], failedDeliveries: alertDeliveries.filter((d) => d.status === 'FAILED').slice(-10).reverse() }));
alertsRoute('GET', '/status', () => ok(alertStatus()));
alertsRoute('GET', '/channels', () => ok(alertChannels.map(channelView)));
alertsRoute('POST', '/channels', ({ body }) => alertCall(() => { const c = alertChannel(json(body) ?? {}, null); alertChannels.push(c); return { status: 201, body: channelView(c) }; }));
alertsRoute('PUT', '/channels/{id}', ({ body, p }) => alertCall(() => {
  const i = alertChannels.findIndex((c) => c.id === +p.id);
  if (i < 0) return error(404, 'Not found');
  alertChannels[i] = alertChannel(json(body) ?? {}, alertChannels[i]);
  return ok(channelView(alertChannels[i]));
}));
alertsRoute('PUT', '/channels/{id}/enabled', ({ body, p }) => {
  const c = alertChannels.find((x) => x.id === +p.id);
  const enabled = json(body)?.enabled;
  if (!c) return error(404, 'Not found');
  if (typeof enabled !== 'boolean') return error(400, 'enabled: true or false');
  return ((c.enabled = enabled), ok(channelView(c)));
});
alertsRoute('DELETE', '/channels/{id}', ({ p }) => {
  const i = alertChannels.findIndex((c) => c.id === +p.id);
  if (i < 0) return error(404, 'Not found');
  alertChannels.splice(i, 1);
  for (const r of alertRules) r.channels = r.channels.filter((c) => c !== +p.id);
  return empty(204);
});
alertsRoute('POST', '/channels/{id}/test', ({ p }) => {
  const c = alertChannels.find((x) => x.id === +p.id);
  if (!c) return error(404, 'Not found');
  const failed = /fail/i.test(c.url ?? c.host ?? '');
  const d = { id: id(), eventId: null, channelId: c.id, channelName: c.name, kind: 'TEST', status: failed ? 'FAILED' : 'SENT', attempts: 1, nextAttemptAt: null, lastError: failed ? 'Connection refused' : null, createdAt: iso(Date.now()), sentAt: failed ? null : iso(Date.now()) };
  alertDeliveries.push(d);
  return ok(d);
});
alertsRoute('GET', '/rules', () => ok(alertRules.map(ruleView)));
// The rooms where a rule applies: no nearer enabled rule (room, floor, building, then global)
alertsRoute('GET', '/rules/{id}/rooms', ({ p }) => {
  const rule = alertRules.find((r) => r.id === +p.id);
  if (!rule) return error(404, 'Not found');
  const rules = [...alertRules.filter((r) => r.enabled && r.id !== rule.id), { ...rule, enabled: true }];
  const rows = [];
  for (const room of elements.filter((e) => e.kind === 'ROOM')) {
    const chain = [room.id, ...pathOf(room).map((e) => e.id).reverse()];
    const distances = rules.map((r) => [r, r.global ? chain.length : chain.findIndex((i) => r.scope.includes(i))]).filter(([, d]) => d >= 0);
    const nearest = Math.min(...distances.map(([, d]) => d));
    if (!distances.some(([r, d]) => r.id === rule.id && d === nearest)) continue;
    const setpoint = effectiveSetpoint(room)?.setpoint.value ?? null;
    const threshold = setpoint == null ? null : setpoint + rule.tolerance;
    const fresh = measurements(room).map((m) => m.measurement).filter((m) => m && Date.now() - m.date <= 30 * MINUTE);
    const hottest = fresh.reduce((a, m) => (!a || m.value > a.value ? m : a), null);
    const temperature = hottest ? Math.round(hottest.value * 10) / 10 : null;
    const exceeding = threshold != null && temperature != null && temperature > threshold;
    rows.push({ id: room.id, name: room.name, place: pathOf(room).map((e) => e.name).join(' › '), setpoint, threshold, temperature,
      measuredAt: hottest ? iso(hottest.date) : null, exceeding, alertId: null, alertSince: null });
  }
  return ok(rows);
});
alertsRoute('POST', '/rules', ({ body }) => alertCall(() => { const r = alertRule(json(body) ?? {}, null); alertRules.push(r); return { status: 201, body: ruleView(r) }; }));
alertsRoute('PUT', '/rules/{id}', ({ body, p }) => alertCall(() => {
  const i = alertRules.findIndex((r) => r.id === +p.id);
  if (i < 0) return error(404, 'Not found');
  alertRules[i] = alertRule(json(body) ?? {}, alertRules[i]);
  return ok(ruleView(alertRules[i]));
}));
alertsRoute('PUT', '/rules/{id}/enabled', ({ body, p }) => {
  const r = alertRules.find((x) => x.id === +p.id);
  const enabled = json(body)?.enabled;
  if (!r) return error(404, 'Not found');
  if (typeof enabled !== 'boolean') return error(400, 'enabled: true or false');
  return ((r.enabled = enabled), ok(ruleView(r)));
});
alertsRoute('DELETE', '/rules/{id}', ({ p }) => {
  const i = alertRules.findIndex((r) => r.id === +p.id);
  if (i < 0) return error(404, 'Not found');
  alertRules.splice(i, 1);
  return empty(204);
});
alertsRoute('GET', '/events', () => ok([]));
alertsRoute('GET', '/deliveries', () => ok([...alertDeliveries].reverse()));

// ================================================================ old API (v1, French names)

/** As the real server (RestServer LegacyApi.kt): /api/… is /api/v2/… with French names. */
const ROOTS = { climat: 'climate', favoris: 'favorites', hierarchie: 'hierarchy', salles: 'rooms', salletemps: 'roomtemps', reglages: 'settings' };
const SEGMENTS = { historique: 'history', moyennes: 'averages', consigne: 'setpoint', consignes: 'setpoints', mesurer: 'measurement', arbre: 'tree', acces: 'access' };
const KEYS = {
  all: 'tout', ancestors: 'ancetres', attached: 'rattache', average: 'moyenne', children: 'enfants', devices: 'boitiers', devicesVisible: 'boitiersVisibles',
  failures: 'echecs', favorite: 'favori', inherited: 'heritee', kept: 'conservees', lastMeasurement: 'derniereMesure', measurements: 'mesures', nodes: 'noeuds',
  ownSetpoints: 'consignesPropres', replaced: 'remplacees', room: 'salle', rooms: 'salles', setpoint: 'consigne', setpoints: 'consignes',
};
const VALUES = {
  kind: { BUILDING: 'BATIMENT', FLOOR: 'ETAGE', ROOM: 'SALLE', DEVICE: 'BOITIER' },
  type: { MANAGER: 'GESTIONNAIRE', PATCH: 'CORRECTIVE', FEATURE: 'FONCTIONNELLE' },
  state: { PENDING: 'EN_ATTENTE', RUNNING: 'EN_COURS', SKIPPED: 'IGNOREE', FAILED: 'ECHEC', RESTARTING: 'REDEMARRAGE', DONE: 'TERMINEE' },
  level: { WARNING: 'AVERTISSEMENT', BLOCKING: 'BLOQUANT' },
  style: { glass: 'verre', panel: 'panneau' },
  typeLabel: { Patch: 'Corrective', Feature: 'Fonctionnelle' },
};
const KEYS_IN = Object.fromEntries(Object.entries(KEYS).map(([en, fr]) => [fr, en]));
const VALUES_IN = Object.fromEntries(Object.entries(VALUES).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([en, fr]) => [fr.toLowerCase(), en]))]));

function englishPath(path) {
  const s = path.split('/').filter(Boolean);
  if (s.length < 2 || s[0] !== 'api' || s[1] === 'v2') return null;
  return ['api', 'v2', ROOTS[s[1]] ?? s[1], ...s.slice(2).map((x, i) => (['username', 'name'].includes(s[i + 1]) ? x : (SEGMENTS[x] ?? x)))].join('/');
}
function translate(v, out, key = null) {
  if (Array.isArray(v)) return v.map((x) => translate(x, out, key));
  if (v && typeof v === 'object') {
    const r = {};
    for (const [k, x] of Object.entries(v)) {
      const nk = (out ? KEYS[k] : KEYS_IN[k]) ?? k;
      r[nk] = translate(x, out, out ? k : nk);
    }
    return r;
  }
  if (typeof v === 'string' && key) return (out ? VALUES[key]?.[v] : VALUES_IN[key]?.[v.toLowerCase()]) ?? v;
  return v;
}

// ================================================================ server

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' };

async function serveStatic(pathOf, res) {
  const root = resolve(APP);
  let file = normalize(join(root, decodeURIComponent(pathOf)));
  if (!file.startsWith(root)) return false;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html'); // routes of the app
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, ETag');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (!url.pathname.startsWith('/api/')) {
    if (APP && (await serveStatic(url.pathname, res))) return;
    return res.writeHead(404).end();
  }
  let body = await readBody(req);
  let path = url.pathname;
  // The old API: rewritten to the new one, its JSON translated both ways
  const english = englishPath(path);
  const legacy = english != null;
  if (legacy) {
    // Before 26.11 there was no /api/server
    if (API === 'old' && english === 'api/v2/server') return send(res, empty(404));
    path = '/' + english;
    const j = /json/.test(req.headers['content-type'] ?? '') ? json(body) : null;
    if (j != null) body = Buffer.from(JSON.stringify(translate(j, false)));
  } else if (API !== 'v2') {
    // A server before 26.12 has no /api/v2
    return send(res, empty(404));
  }
  const reply = (r) => send(res, legacy && r.body !== undefined && !r.raw ? { ...r, body: translate(r.body, true) } : r);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const ctx = { req, body, q: url.searchParams, p: m.groups ?? {} };
    if (r.role !== 'public') {
      const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const session = token && tokens.get(token);
      const user = session && Date.parse(session.expiresAt) > Date.now() && users.find((u) => u.id === session.userId);
      if (!user) return reply(error(401, token ? 'Invalid or expired token' : 'Missing bearer token'));
      // A provisional password: only the account and the change of password (26.12)
      if (user.mustChangePassword && !/^\/api\/v2\/auth\/(me|logout|password)$/.test(path)) {
        return reply({ status: 403, body: { error: 'Password change required', code: 'password_change_required' } });
      }
      const roleOk = r.role === 'auth' || user.type === 'ADMIN' || (r.role === 'MANAGER' && user.type === 'MANAGER') || (r.role === 'owner' && +ctx.p.id === user.id);
      if (!roleOk) return reply(error(403, 'Forbidden'));
      Object.assign(ctx, { user, token, scopeOf: scope(user) });
    }
    try {
      const res = await r.f(ctx);
      if (ctx.user && req.method !== 'GET' && (res?.status ?? 200) < 300) audited(req.method, path, ctx, res);
      return reply(res);
    } catch (e) {
      console.error(e);
      return reply(error(500, e.message));
    }
  }
  reply(empty(404));
}).listen(PORT, () => {
  const api = { v2: 'v1 + v2 (26.12)', v1: 'v1, /api/server (26.11)', old: 'v1 only (before 26.11)' }[API];
  console.log(`ThermoBox (demo, API ${api}): http://localhost:${PORT}/api${APP ? `, app on http://localhost:${PORT}/` : ''}`);
  console.log('Accounts: admin / admin1234 · gestion / gestion1234 · lecteur / lecteur1234 · camille / camille1234 · nouveau / Prov-2026-demo (provisional)');
});

function send(res, r) {
  if (r.raw) {
    res.writeHead(r.status, { 'Content-Type': r.type, ...(r.headers ?? {}) });
    return res.end(r.raw);
  }
  if (r.body === undefined) return res.writeHead(r.status, r.headers ?? {}).end();
  const text = JSON.stringify(r.body);
  // Compressed as the real server does (EncodingFilter) for the clients that accept it
  if (text.length > 1024 && /\bgzip\b/.test(res.req.headers['accept-encoding'] ?? '')) {
    res.writeHead(r.status, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ...(r.headers ?? {}) });
    return res.end(gzipSync(text));
  }
  res.writeHead(r.status, { 'Content-Type': 'application/json', ...(r.headers ?? {}) });
  res.end(text);
}
