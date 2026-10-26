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
const MEASURE_STEP = 15 * MINUTE;

let nextId = 1;
const id = () => nextId++;

const users = [
  { id: id(), username: 'admin', password: 'admin1234', type: 'ADMIN' },
  { id: id(), username: 'gestion', password: 'gestion1234', type: 'MANAGER' },
  { id: id(), username: 'lecteur', password: 'lecteur1234', type: 'VIEWER' },
  { id: id(), username: 'camille', password: 'camille1234', type: 'VIEWER' },
];

/** Elements: { id, name, kind }, links child → parent. */
const elements = [];
const parents = new Map();
function element(name, kind, parent) {
  const e = { id: id(), name, kind };
  elements.push(e);
  if (parent) parents.set(e.id, parent.id);
  return e;
}
const bldA = element('Bâtiment A', 'BUILDING');
const fl1 = element('Étage 1', 'FLOOR', bldA);
const s101 = element('Salle 101', 'ROOM', fl1);
const s102 = element('Salle 102', 'ROOM', fl1);
const fl2 = element('Étage 2', 'FLOOR', bldA);
const s201 = element('Amphithéâtre', 'ROOM', fl2);
const s202 = element('Bibliothèque', 'ROOM', fl2);
const bldB = element('Bâtiment B', 'BUILDING');
const meeting = element('Salle de réunion', 'ROOM', bldB);
const serverRoom = element('Salle serveurs', 'ROOM', bldB);
const lobby = element('Accueil', 'ROOM', bldB);
const devices = [
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
];

/** Temperatures: { id, type: 'setpoint' | 'measurement', value, date (ms), room (element id) } */
const temperatures = [];
function temperature(type, value, date, room) {
  const t = { id: id(), type, value: Math.round(value * 10) / 10, date, room };
  temperatures.push(t);
  return t;
}

const now = Date.now();
temperature('setpoint', 21, now - 40 * DAY, bldA.id);
temperature('setpoint', 20.5, now - 6 * DAY, bldA.id);
temperature('setpoint', 21, now - 2 * DAY, bldA.id);
temperature('setpoint', 21.5, now - 40 * DAY, bldB.id);
temperature('setpoint', 18, now - 40 * DAY, serverRoom.id);
temperature('setpoint', 22.5, now - 3 * DAY, s201.id);

// 30 days of measures per box: a daily cycle around its own level, drawn towards the setpoint
const historyStart = Math.floor((now - 31 * DAY) / MEASURE_STEP) * MEASURE_STEP;
for (const [b, level] of devices) {
  const phase = Math.random() * Math.PI * 2;
  for (let t = historyStart; t <= now; t += MEASURE_STEP) {
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const day = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.9;
    const slow = Math.sin(t / (3 * DAY) + phase) * 0.6;
    temperature('measurement', level + day + slow + (Math.random() - 0.5) * 0.25, t, b.id);
  }
}

// Every 30 s, each box reports
setInterval(() => {
  const t = Date.now();
  for (const [b, level] of devices) {
    const last = lastMeasurement(b.id);
    const target = effectiveSetpoint(parents.get(b.id) ? elementById(parents.get(b.id)) : b)?.setpoint.value ?? level;
    const v = (last?.value ?? level) + (target - (last?.value ?? level)) * 0.04 + (Math.random() - 0.5) * 0.2;
    temperature('measurement', v, t, b.id);
  }
}, 30_000).unref();

const favorites = new Map([[1, new Set([s101.id, serverRoom.id])]]);
/** Limited users: user id → granted element ids. Absent: sees everything. */
const restricted = new Map([[3, new Set([bldA.id])], [4, new Set()]]);
const groups = [{ id: id(), name: 'Équipe bâtiment B', description: 'Techniciens du bâtiment B', members: new Set([4]), elements: new Set([bldB.id]) }];
const images = new Map();
const settings = { style: 'glass' };
const tokens = new Map();

// ================================================================ hierarchy and climate

const elementById = (i) => elements.find((e) => e.id === i) ?? null;
const childrenOf = (p) => elements.filter((e) => parents.get(e.id) === p.id).sort(byKind);
const KIND_ORDER = ['BUILDING', 'FLOOR', 'ROOM', 'DEVICE'];
function byKind(a, b) {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'fr');
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
  let d = null;
  for (const t of temperatures) if (t.type === 'measurement' && t.room === deviceId && (!d || t.date > d.date)) d = t;
  return d;
}
const measurements = (e) => devicesUnder(e).map((b) => ({ device: b, measurement: lastMeasurement(b.id) }));
function ownSetpoint(e) {
  let d = null;
  for (const t of temperatures) if (t.type === 'setpoint' && t.room === e.id && (!d || t.date > d.date)) d = t;
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
  return descendants(e)
    .filter((d) => d.kind === 'FLOOR' || d.kind === 'ROOM')
    .map((d) => ({ d, c: ownSetpoint(d) }))
    .filter((x) => x.c && x.c.date >= (effectiveSetpoint(e)?.setpoint.date ?? 0) && x.c.value !== effectiveSetpoint(e)?.setpoint.value)
    .map((x) => ({ setpoint: x.c, source: x.d, inherited: false }));
}
function history(e, start, end) {
  return devicesUnder(e).map((b) => ({
    device: b,
    measurements: temperatures.filter((t) => t.type === 'measurement' && t.room === b.id && t.date >= start && t.date <= end).sort((x, y) => x.date - y.date),
  }));
}
function runningAverage(hs) {
  const dates = [...new Set(hs.flatMap((h) => h.measurements.map((m) => m.date)))].sort((a, b) => a - b);
  const pos = hs.map(() => 0);
  const lastValues = hs.map(() => null);
  return dates.map((d) => {
    hs.forEach((h, i) => {
      while (pos[i] < h.measurements.length && h.measurements[pos[i]].date <= d) lastValues[i] = h.measurements[pos[i]++].value;
    });
    const v = lastValues.filter((x) => x != null);
    return { date: d, value: v.reduce((a, b) => a + b, 0) / v.length };
  });
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
const userDto = (u) => ({ id: u.id, username: u.username, type: u.type });

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
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 8 * HOUR).toISOString();
  tokens.set(token, { userId: u.id, expiresAt });
  return ok({ token, tokenType: 'Bearer', expiresAt, user: userDto(u) });
});
route('POST', '/api/v2/auth/logout', 'auth', ({ token }) => (tokens.delete(token), empty()));
route('GET', '/api/v2/auth/me', 'auth', ({ user }) => ok(userDto(user)));

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
  for (const [c, parent] of [...parents]) if (parent === e.id || c === e.id) parents.delete(c);
  elements.splice(elements.indexOf(e), 1);
  for (let i = temperatures.length - 1; i >= 0; i--) if (temperatures[i].room === e.id) temperatures.splice(i, 1);
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
    parents.delete(e.id);
    return null;
  }
  const parent = elementById(parentId);
  if (!parent) return error(400, `Unknown parent ${parentId}`);
  if (!PARENTS[e.kind].includes(parent.kind)) return error(400, `${e.kind} cannot go into ${parent.kind}`);
  if (descendants(e).some((d) => d.id === parent.id) || parent.id === e.id) return error(400, 'An element cannot go into what it contains');
  parents.set(e.id, parent.id);
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
  const setpoints = c ? temperatures.filter((t) => t.type === 'setpoint' && t.room === c.source.id && t.date <= end) : [];
  // The one in force at the start, then those of the period
  const before = setpoints.filter((t) => t.date < start).sort((a, b) => b.date - a.date)[0];
  const periodSetpoints = [...(before ? [{ ...before, date: start }] : []), ...setpoints.filter((t) => t.date >= start)].sort((a, b) => a.date - b.date);
  const container = e.kind === 'FLOOR' || e.kind === 'BUILDING';
  return ok({
    devices: container || !seesDevices(user) ? [] : hs.map((h) => ({ id: h.device.id, name: h.device.name, points: h.measurements.map(point) })),
    rooms: container
      ? descendants(e)
          .filter((d) => d.kind === 'ROOM')
          .sort(byKind)
          .map((s) => {
            const ids = new Set(devicesUnder(s).map((b) => b.id));
            return { id: s.id, name: s.name, points: runningAverage(hs.filter((h) => ids.has(h.device.id))).map(point) };
          })
          .filter((s) => s.points.length)
      : [],
    average: runningAverage(hs).map(point),
    setpoints: periodSetpoints.map(point),
  });
});
route('GET', '/api/v2/climate/averages', 'auth', ({ q, scopeOf }) => {
  const per = period(q);
  if (!per) return error(400, 'start and end must be ISO-8601 instants, start before end');
  const r = {};
  for (const i of (q.get('ids') ?? '').split(',').map(Number).filter(Boolean)) {
    const e = elementById(i);
    if (e && canSee(scopeOf, e)) r[i] = runningAverage(history(e, per[0], per[1])).map(point);
  }
  return ok(r);
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

// ---- temperatures (entities: dates as Jackson arrays)
const temperatureDto = (t) => ({ id: t.id, value: t.value, date: dateArray(t.date) });
const allowed = (scopeOf) => temperatures.filter((t) => canSee(scopeOf, elementById(t.room)));
route('GET', '/api/v2/temperatures', 'auth', ({ scopeOf }) => ok(allowed(scopeOf).map(temperatureDto)));
route('GET', '/api/v2/temperatures/type/{type}', 'auth', ({ p, scopeOf }) => {
  if (!['setpoint', 'measurement'].includes(p.type)) return ok(null);
  return ok(allowed(scopeOf).filter((t) => t.type === p.type).map(temperatureDto));
});
route('POST', '/api/v2/temperatures/type/{type}', 'ADMIN', ({ p, body }) => {
  const c = json(body) ?? {};
  if (!['setpoint', 'measurement'].includes(p.type)) return empty(404);
  if (typeof c.value !== 'number') return error(400, 'value is required');
  temperature(p.type, c.value, c.date ? Date.parse(c.date) : Date.now(), null);
  return empty(201);
});
route('PUT', '/api/v2/temperatures/{id}', 'ADMIN', ({ p, body }) => {
  const t = temperatures.find((x) => x.id === +p.id);
  const c = json(body) ?? {};
  if (t) {
    if (typeof c.value === 'number') t.value = c.value;
    if (c.date) t.date = Array.isArray(c.date) ? new Date(c.date[0], c.date[1] - 1, c.date[2], c.date[3] ?? 0, c.date[4] ?? 0).getTime() : Date.parse(c.date);
  }
  return empty();
});
route('DELETE', '/api/v2/temperatures/{id}', 'ADMIN', ({ p }) => {
  const i = temperatures.findIndex((x) => x.id === +p.id);
  if (i >= 0) temperatures.splice(i, 1);
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
    ? { name: 'ThermoBox', version: SERVER_VERSION, apiVersions: ['v1', 'v2'], logo: `/api/v2/server/logo?v=${logoVersion()}`, logoSource: logo ? 'custom' : 'default' }
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
      const roleOk = r.role === 'auth' || user.type === 'ADMIN' || (r.role === 'MANAGER' && user.type === 'MANAGER') || (r.role === 'owner' && +ctx.p.id === user.id);
      if (!roleOk) return reply(error(403, 'Forbidden'));
      Object.assign(ctx, { user, token, scopeOf: scope(user) });
    }
    try {
      return reply(await r.f(ctx));
    } catch (e) {
      console.error(e);
      return reply(error(500, e.message));
    }
  }
  reply(empty(404));
}).listen(PORT, () => {
  const api = { v2: 'v1 + v2 (26.12)', v1: 'v1, /api/server (26.11)', old: 'v1 only (before 26.11)' }[API];
  console.log(`ThermoBox (demo, API ${api}): http://localhost:${PORT}/api${APP ? `, app on http://localhost:${PORT}/` : ''}`);
  console.log('Accounts: admin / admin1234 · gestion / gestion1234 · lecteur / lecteur1234 · camille / camille1234');
});

function send(res, r) {
  if (r.raw) {
    res.writeHead(r.status, { 'Content-Type': r.type, ...(r.headers ?? {}) });
    return res.end(r.raw);
  }
  if (r.body === undefined) return res.writeHead(r.status).end();
  res.writeHead(r.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.body));
}
