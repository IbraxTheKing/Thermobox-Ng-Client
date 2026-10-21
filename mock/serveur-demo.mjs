#!/usr/bin/env node
/*
 * ThermoBox demo server: the REST API of RestServer (branch dev, with the /api/hierarchie,
 * /api/climat, /api/favoris, /api/reglages and photo routes), in memory, with simulated boxes.
 *
 * For developing and trying the Angular client without Java, MySQL or boxes:
 *
 *   npm run demo            # this server on :8080 + ng serve (proxy /api → :8080)
 *   node mock/serveur-demo.mjs [--port 8080] [--app dist/Thermobox-Ng-Client/browser]
 *
 * Accounts: admin / admin1234 (ADMIN), gestion / gestion1234 (GESTIONNAIRE),
 * lecteur / lecteur1234 (VIEWER, limited to « Bâtiment A »).
 *
 * Not the real server: no persistence, simplified rules. The JSON follows the Kotlin DTOs.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (nom, def) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(option('port', process.env.PORT ?? 8080));
const APP = option('app', null);

// ================================================================ data

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
const PAS_MESURES = 15 * MINUTE;

let suivant = 1;
const id = () => suivant++;

const users = [
  { id: id(), username: 'admin', password: 'admin1234', type: 'ADMIN' },
  { id: id(), username: 'gestion', password: 'gestion1234', type: 'GESTIONNAIRE' },
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
const batA = element('Bâtiment A', 'BATIMENT');
const et1 = element('Étage 1', 'ETAGE', batA);
const s101 = element('Salle 101', 'SALLE', et1);
const s102 = element('Salle 102', 'SALLE', et1);
const et2 = element('Étage 2', 'ETAGE', batA);
const s201 = element('Amphithéâtre', 'SALLE', et2);
const s202 = element('Bibliothèque', 'SALLE', et2);
const batB = element('Bâtiment B', 'BATIMENT');
const reunion = element('Salle de réunion', 'SALLE', batB);
const serveurs = element('Salle serveurs', 'SALLE', batB);
const accueil = element('Accueil', 'SALLE', batB);
const boitiers = [
  [element('Boîtier 101-A', 'BOITIER', s101), 21.2],
  [element('Boîtier 101-B', 'BOITIER', s101), 20.6],
  [element('Boîtier 102', 'BOITIER', s102), 19.1],
  [element('Boîtier amphi nord', 'BOITIER', s201), 22.4],
  [element('Boîtier amphi sud', 'BOITIER', s201), 23.1],
  [element('Boîtier biblio', 'BOITIER', s202), 20.9],
  [element('Boîtier réunion', 'BOITIER', reunion), 21.4],
  [element('Boîtier baie 1', 'BOITIER', serveurs), 18.4],
  [element('Boîtier baie 2', 'BOITIER', serveurs), 19.7],
  [element('Boîtier accueil', 'BOITIER', accueil), 17.6],
  [element('Boîtier 0x3F2A', 'BOITIER', null), 20.2],
];

/** Temperatures: { id, type: 'consigne' | 'mesurer', value, date (ms), salle (element id) } */
const temperatures = [];
function temperature(type, value, date, salle) {
  const t = { id: id(), type, value: Math.round(value * 10) / 10, date, salle };
  temperatures.push(t);
  return t;
}

const maintenant = Date.now();
temperature('consigne', 21, maintenant - 40 * JOUR, batA.id);
temperature('consigne', 20.5, maintenant - 6 * JOUR, batA.id);
temperature('consigne', 21, maintenant - 2 * JOUR, batA.id);
temperature('consigne', 21.5, maintenant - 40 * JOUR, batB.id);
temperature('consigne', 18, maintenant - 40 * JOUR, serveurs.id);
temperature('consigne', 22.5, maintenant - 3 * JOUR, s201.id);

// 30 days of measures per box: a daily cycle around its own level, drawn towards the consigne
const debutHistorique = Math.floor((maintenant - 31 * JOUR) / PAS_MESURES) * PAS_MESURES;
for (const [b, niveau] of boitiers) {
  const phase = Math.random() * Math.PI * 2;
  for (let t = debutHistorique; t <= maintenant; t += PAS_MESURES) {
    const heure = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const jour = Math.sin(((heure - 6) / 24) * Math.PI * 2) * 0.9;
    const lent = Math.sin(t / (3 * JOUR) + phase) * 0.6;
    temperature('mesurer', niveau + jour + lent + (Math.random() - 0.5) * 0.25, t, b.id);
  }
}

// Every 30 s, each box reports
setInterval(() => {
  const t = Date.now();
  for (const [b, niveau] of boitiers) {
    const derniere = derniereMesure(b.id);
    const cible = consigneEffective(parents.get(b.id) ? elementParId(parents.get(b.id)) : b)?.consigne.value ?? niveau;
    const v = (derniere?.value ?? niveau) + (cible - (derniere?.value ?? niveau)) * 0.04 + (Math.random() - 0.5) * 0.2;
    temperature('mesurer', v, t, b.id);
  }
}, 30_000).unref();

const favoris = new Map([[1, new Set([s101.id, serveurs.id])]]);
/** Limited users: user id → granted element ids. Absent: sees everything. */
const accesRestreints = new Map([[3, new Set([batA.id])], [4, new Set()]]);
const groupes = [{ id: id(), nom: 'Équipe bâtiment B', description: 'Techniciens du bâtiment B', membres: new Set([4]), elements: new Set([batB.id]) }];
const images = new Map();
const reglages = { style: 'verre' };
const jetons = new Map();

// ================================================================ hierarchy and climate

const elementParId = (i) => elements.find((e) => e.id === i) ?? null;
const enfants = (p) => elements.filter((e) => parents.get(e.id) === p.id).sort(ordre);
const ordreKinds = ['BATIMENT', 'ETAGE', 'SALLE', 'BOITIER'];
function ordre(a, b) {
  return ordreKinds.indexOf(a.kind) - ordreKinds.indexOf(b.kind) || a.name.localeCompare(b.name, 'fr');
}
function chemin(e) {
  const r = [];
  let p = parents.get(e.id);
  while (p != null && r.length < 5) {
    const x = elementParId(p);
    if (!x) break;
    r.unshift(x);
    p = parents.get(x.id);
  }
  return r;
}
function descendants(e) {
  const r = [];
  const parcourir = (x, d) => {
    if (d > 5) return;
    for (const c of enfants(x)) {
      r.push(c);
      if (c.kind !== 'BOITIER') parcourir(c, d + 1);
    }
  };
  parcourir(e, 0);
  return r;
}
const boitiersSous = (e) => (e.kind === 'BOITIER' ? [e] : descendants(e).filter((d) => d.kind === 'BOITIER'));
const PARENTS = { BATIMENT: [], ETAGE: ['BATIMENT'], SALLE: ['ETAGE', 'BATIMENT'], BOITIER: ['SALLE'] };

function derniereMesure(boitierId) {
  let d = null;
  for (const t of temperatures) if (t.type === 'mesurer' && t.salle === boitierId && (!d || t.date > d.date)) d = t;
  return d;
}
const mesures = (e) => boitiersSous(e).map((b) => ({ boitier: b, mesure: derniereMesure(b.id) }));
function consignePropre(e) {
  let d = null;
  for (const t of temperatures) if (t.type === 'consigne' && t.salle === e.id && (!d || t.date > d.date)) d = t;
  return d;
}
function consigneEffective(e) {
  if (e.kind === 'BOITIER') return null;
  const propre = consignePropre(e);
  if (propre) return { consigne: propre, source: e, heritee: false };
  for (const a of [...chemin(e)].reverse()) {
    const c = consignePropre(a);
    if (c) return { consigne: c, source: a, heritee: true };
  }
  return null;
}
function consignesPropres(e) {
  return descendants(e)
    .filter((d) => d.kind === 'ETAGE' || d.kind === 'SALLE')
    .map((d) => ({ d, c: consignePropre(d) }))
    .filter((x) => x.c && x.c.date >= (consigneEffective(e)?.consigne.date ?? 0) && x.c.value !== consigneEffective(e)?.consigne.value)
    .map((x) => ({ consigne: x.c, source: x.d, heritee: false }));
}
function historique(e, debut, fin) {
  return boitiersSous(e).map((b) => ({
    boitier: b,
    mesures: temperatures.filter((t) => t.type === 'mesurer' && t.salle === b.id && t.date >= debut && t.date <= fin).sort((x, y) => x.date - y.date),
  }));
}
function moyenneGlissante(hs) {
  const dates = [...new Set(hs.flatMap((h) => h.mesures.map((m) => m.date)))].sort((a, b) => a - b);
  const pos = hs.map(() => 0);
  const dernieres = hs.map(() => null);
  return dates.map((d) => {
    hs.forEach((h, i) => {
      while (pos[i] < h.mesures.length && h.mesures[pos[i]].date <= d) dernieres[i] = h.mesures[pos[i]++].value;
    });
    const v = dernieres.filter((x) => x != null);
    return { date: d, value: v.reduce((a, b) => a + b, 0) / v.length };
  });
}

// ================================================================ accesses

function perimetre(user) {
  if (user.type === 'ADMIN' || !accesRestreints.has(user.id)) return { tout: true };
  const accordes = new Set(accesRestreints.get(user.id));
  for (const g of groupes) if (g.membres.has(user.id)) for (const e of g.elements) accordes.add(e);
  const accessibles = new Set();
  for (const i of accordes) {
    const e = elementParId(i);
    if (!e) continue;
    accessibles.add(e.id);
    for (const d of descendants(e)) accessibles.add(d.id);
  }
  const visibles = new Set(accessibles);
  for (const i of accessibles) for (const a of chemin(elementParId(i))) visibles.add(a.id);
  return { tout: false, accessibles, visibles };
}
const peutVoir = (p, e) => !!e && (p.tout || p.accessibles.has(e.id));
const estVisible = (p, e) => !!e && (p.tout || p.visibles.has(e.id));
const voitBoitiers = (u) => u.type === 'ADMIN' || u.type === 'GESTIONNAIRE';

// ================================================================ JSON

/** LocalDateTime as Jackson writes it by default: an array. */
function tableauDate(ms) {
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
const consigneDto = (c) => ({ value: c.consigne.value, date: iso(c.consigne.date), heritee: c.heritee, sourceId: c.source.id, sourceName: c.source.name });
const userDto = (u) => ({ id: u.id, username: u.username, type: u.type });

function noeud(e, user, p) {
  const parentId = parents.get(e.id) ?? null;
  const rattache = parentId != null || e.kind === 'BATIMENT';
  const accessible = peutVoir(p, e) && (e.kind !== 'BOITIER' || voitBoitiers(user));
  if (!accessible) return { id: e.id, name: e.name, kind: e.kind, parentId, rattache, accessible: false, temperature: null, derniereMesure: null, boitiers: 0, consigne: null, image: null, favori: false };
  const ms = mesures(e);
  const valeurs = ms.map((m) => m.mesure?.value).filter((v) => v != null);
  const c = consigneEffective(e);
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    parentId,
    rattache,
    accessible: true,
    temperature: e.kind === 'BOITIER' ? (valeurs[0] ?? null) : valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : null,
    derniereMesure: iso(Math.max(...ms.map((m) => m.mesure?.date ?? -Infinity)) === -Infinity ? null : Math.max(...ms.map((m) => m.mesure?.date ?? -Infinity))),
    boitiers: voitBoitiers(user) ? ms.length : 0,
    consigne: c ? consigneDto(c) : null,
    image: images.get(e.id)?.version ?? null,
    favori: favoris.get(user.id)?.has(e.id) ?? false,
  };
}

// ================================================================ HTTP

const routes = [];
const route = (methode, motif, role, f) => routes.push({ methode, re: new RegExp(`^${motif.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`), role, f });

const ok = (corps, statut = 200) => ({ statut, corps });
const vide = (statut = 204) => ({ statut });
const erreur = (statut, message) => ({ statut, corps: { error: message } });

function lireCorps(req) {
  return new Promise((r) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => r(Buffer.concat(morceaux)));
  });
}
const json = (b) => {
  try {
    return b.length ? JSON.parse(b.toString('utf8')) : null;
  } catch {
    return null;
  }
};
const periode = (q) => {
  const debut = Date.parse(q.get('start') ?? '');
  const fin = Date.parse(q.get('end') ?? '');
  return isNaN(debut) || isNaN(fin) || debut >= fin ? null : [debut, fin];
};

// ---- auth
route('POST', '/api/auth/login', 'public', ({ corps }) => {
  const c = json(corps) ?? {};
  if (!c.username || !c.password) return erreur(400, 'username and password are required');
  const u = users.find((x) => x.username === String(c.username).trim() && x.password === c.password);
  if (!u) return erreur(401, 'Invalid username or password');
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 8 * HEURE).toISOString();
  jetons.set(token, { userId: u.id, expiresAt });
  return ok({ token, tokenType: 'Bearer', expiresAt, user: userDto(u) });
});
route('POST', '/api/auth/logout', 'auth', ({ token }) => (jetons.delete(token), vide()));
route('GET', '/api/auth/me', 'auth', ({ user }) => ok(userDto(user)));

// ---- users
route('GET', '/api/users', 'ADMIN', () => ok(users.map(userDto)));
route('POST', '/api/users', 'public', ({ corps }) => {
  const c = json(corps) ?? {};
  const username = String(c.username ?? '').trim();
  if (!username || !c.password) return erreur(400, 'username and password are required');
  if (users.some((u) => u.username === username)) return erreur(409, 'Username already taken');
  const u = { id: id(), username, password: c.password, type: 'VIEWER' };
  users.push(u);
  accesRestreints.set(u.id, new Set());
  return vide(201);
});
route('GET', '/api/users/username/{nom}', 'ADMIN', ({ p }) => {
  const u = users.find((x) => x.username === decodeURIComponent(p.nom));
  return u ? ok(userDto(u)) : vide(404);
});
route('GET', '/api/users/{id}', 'owner', ({ p }) => {
  const u = users.find((x) => x.id === +p.id);
  return u ? ok(userDto(u)) : vide(404);
});
route('PUT', '/api/users/{id}', 'owner', ({ p, corps, user }) => {
  const u = users.find((x) => x.id === +p.id);
  if (!u) return vide(404);
  const c = json(corps) ?? {};
  if (c.type && c.type !== u.type && user.type !== 'ADMIN') return erreur(403, 'Only an admin can change a role');
  const nom = c.username?.trim();
  if (nom && nom !== u.username) {
    if (users.some((x) => x.username === nom)) return erreur(409, 'Username already taken');
    u.username = nom;
  }
  if (c.password) u.password = c.password;
  if (c.type) u.type = c.type;
  return ok(userDto(u));
});
route('DELETE', '/api/users/{id}', 'owner', ({ p }) => {
  const i = users.findIndex((x) => x.id === +p.id);
  if (i < 0) return vide(404);
  users.splice(i, 1);
  return vide();
});
const accesDto = (u) => {
  const restreint = u.type !== 'ADMIN' && accesRestreints.has(u.id);
  return { restricted: restreint, elements: restreint ? [...accesRestreints.get(u.id)].map(elementParId).filter(Boolean).map((e) => ({ id: e.id, name: e.name, kind: e.kind })) : [] };
};
route('GET', '/api/users/{id}/acces', 'owner', ({ p }) => {
  const u = users.find((x) => x.id === +p.id);
  return u ? ok(accesDto(u)) : vide(404);
});
route('PUT', '/api/users/{id}/acces', 'ADMIN', ({ p, corps }) => {
  const u = users.find((x) => x.id === +p.id);
  if (!u) return vide(404);
  const c = json(corps) ?? {};
  if (u.type === 'ADMIN') return erreur(400, 'An ADMIN always sees everything');
  if (c.restricted === false) accesRestreints.delete(u.id);
  else accesRestreints.set(u.id, new Set(c.elements ?? []));
  return ok(accesDto(u));
});

// ---- groups
const groupeDto = (g) => ({
  id: g.id,
  name: g.nom,
  description: g.description,
  members: [...g.membres].map((m) => users.find((u) => u.id === m)).filter(Boolean).map((u) => ({ id: u.id, username: u.username })),
  elements: [...g.elements].map(elementParId).filter(Boolean).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
});
route('GET', '/api/groups', 'ADMIN', () => ok(groupes.map(groupeDto)));
route('GET', '/api/groups/{id}', 'ADMIN', ({ p }) => {
  const g = groupes.find((x) => x.id === +p.id);
  return g ? ok(groupeDto(g)) : vide(404);
});
function enregistrerGroupe(g, c) {
  const nom = String(c?.name ?? '').trim();
  if (!nom) return erreur(400, 'Le nom du groupe est obligatoire');
  if (groupes.some((x) => x !== g && x.nom === nom)) return erreur(400, `Le nom « ${nom} » est déjà utilisé`);
  const cible = g ?? { id: id() };
  Object.assign(cible, { nom, description: c.description ?? null, membres: new Set(c.members ?? []), elements: new Set(c.elements ?? []) });
  if (!g) groupes.push(cible);
  return ok(groupeDto(cible), g ? 200 : 201);
}
route('POST', '/api/groups', 'ADMIN', ({ corps }) => enregistrerGroupe(null, json(corps)));
route('PUT', '/api/groups/{id}', 'ADMIN', ({ p, corps }) => {
  const g = groupes.find((x) => x.id === +p.id);
  return g ? enregistrerGroupe(g, json(corps)) : vide(404);
});
route('DELETE', '/api/groups/{id}', 'ADMIN', ({ p }) => {
  const i = groupes.findIndex((x) => x.id === +p.id);
  if (i >= 0) groupes.splice(i, 1);
  return vide();
});

// ---- salles (without kind) and photos
route('GET', '/api/salles', 'auth', ({ perim }) => ok(elements.filter((e) => peutVoir(perim, e)).map((e) => ({ id: e.id, name: e.name }))));
route('DELETE', '/api/salles/{id}', 'ADMIN', ({ p }) => {
  const e = elementParId(+p.id);
  if (!e) return vide();
  for (const [c, par] of [...parents]) if (par === e.id || c === e.id) parents.delete(c);
  elements.splice(elements.indexOf(e), 1);
  for (let i = temperatures.length - 1; i >= 0; i--) if (temperatures[i].salle === e.id) temperatures.splice(i, 1);
  images.delete(e.id);
  return vide();
});
route('GET', '/api/salles/{id}/image', 'auth', ({ p, perim }) => {
  const e = elementParId(+p.id);
  const img = e && peutVoir(perim, e) ? images.get(e.id) : null;
  return img ? { statut: 200, brut: img.data, type: img.type, entetes: { ETag: `"${img.version}"`, 'Cache-Control': 'private, no-cache' } } : vide(404);
});
route('PUT', '/api/salles/{id}/image', 'ADMIN', ({ p, corps, req }) => {
  const e = elementParId(+p.id);
  if (!e) return vide(404);
  if (!corps.length) return erreur(400, 'Le fichier est vide.');
  if (corps.length > 10 * 1024 * 1024) return erreur(400, "L'image ne doit pas dépasser 10 Mo.");
  const version = Date.now();
  images.set(e.id, { data: corps, type: req.headers['content-type'] || 'image/jpeg', version });
  return ok({ image: version });
});
route('DELETE', '/api/salles/{id}/image', 'ADMIN', ({ p }) => (images.delete(+p.id), vide()));

// ---- hierarchy
route('GET', '/api/hierarchie/arbre', 'auth', ({ user, perim }) =>
  ok({
    tout: perim.tout,
    boitiersVisibles: voitBoitiers(user),
    noeuds: [...elements].filter((e) => estVisible(perim, e) && (e.kind !== 'BOITIER' || voitBoitiers(user))).sort(ordre).map((e) => noeud(e, user, perim)),
  }),
);
route('GET', '/api/hierarchie/elements/{id}', 'auth', ({ p, user, perim }) => {
  const e = elementParId(+p.id);
  if (!e || !peutVoir(perim, e) || (e.kind === 'BOITIER' && !voitBoitiers(user))) return vide(404);
  const conteneur = e.kind === 'ETAGE' || e.kind === 'BATIMENT';
  return ok({
    element: noeud(e, user, perim),
    ancetres: chemin(e).map((a) => elementDto(a, peutVoir(perim, a))),
    enfants: e.kind === 'BOITIER' ? [] : enfants(e).filter((c) => c.kind !== 'BOITIER' || voitBoitiers(user)).map((c) => elementDto(c, peutVoir(perim, c))),
    mesures: voitBoitiers(user) ? mesures(e).map((m) => ({ id: m.boitier.id, name: m.boitier.name, value: m.mesure?.value ?? null, date: iso(m.mesure?.date) })) : [],
    consignesPropres: e.kind === 'BOITIER' ? [] : consignesPropres(e).map(consigneDto),
    salles: conteneur ? descendants(e).filter((d) => d.kind === 'SALLE').sort(ordre).map((s) => noeud(s, user, perim)) : [],
  });
});
function placer(e, parentId) {
  if (parentId == null) {
    parents.delete(e.id);
    return null;
  }
  const parent = elementParId(parentId);
  if (!parent) return erreur(400, `Unknown parent ${parentId}`);
  if (!PARENTS[e.kind].includes(parent.kind)) return erreur(400, `${e.kind} ne peut pas aller dans ${parent.kind}`);
  if (descendants(e).some((d) => d.id === parent.id) || parent.id === e.id) return erreur(400, 'Un élément ne peut pas aller dans ce qu’il contient');
  parents.set(e.id, parent.id);
  return null;
}
route('POST', '/api/hierarchie/elements', 'ADMIN', ({ corps, user, perim }) => {
  const c = json(corps) ?? {};
  if (!ordreKinds.includes(c.kind)) return erreur(400, 'kind must be one of BATIMENT, ETAGE, SALLE, BOITIER');
  if (!String(c.name ?? '').trim()) return erreur(400, 'name is required');
  const e = { id: id(), name: c.name.trim(), kind: c.kind };
  const refus = placer(e, c.parentId ?? null);
  if (refus) return refus;
  elements.push(e);
  return ok(noeud(e, user, perim), 201);
});
route('PUT', '/api/hierarchie/elements/{id}', 'ADMIN', ({ p, corps, user, perim }) => {
  const e = elementParId(+p.id);
  if (!e) return vide(404);
  const c = json(corps) ?? {};
  if (!String(c.name ?? '').trim()) return erreur(400, 'name is required');
  const refus = placer(e, c.parentId ?? null);
  if (refus) return refus;
  e.name = c.name.trim();
  return ok(noeud(e, user, perim));
});
route('PUT', '/api/hierarchie/elements/{id}/parent', 'ADMIN', ({ p, corps, user, perim }) => {
  const e = elementParId(+p.id);
  if (!e) return vide(404);
  const refus = placer(e, json(corps)?.parentId ?? null);
  return refus ?? ok(noeud(e, user, perim));
});

// ---- climate
route('GET', '/api/climat/{id}/historique', 'auth', ({ p, q, user, perim }) => {
  const e = elementParId(+p.id);
  if (!e || !peutVoir(perim, e)) return vide(404);
  const per = periode(q);
  if (!per) return erreur(400, 'start and end must be ISO-8601 instants, start before end');
  const [debut, fin] = per;
  const hs = historique(e, debut, fin);
  const c = consigneEffective(e);
  const consignes = c ? temperatures.filter((t) => t.type === 'consigne' && t.salle === c.source.id && t.date <= fin) : [];
  // The one in force at the start, then those of the period
  const avant = consignes.filter((t) => t.date < debut).sort((a, b) => b.date - a.date)[0];
  const periodeConsignes = [...(avant ? [{ ...avant, date: debut }] : []), ...consignes.filter((t) => t.date >= debut)].sort((a, b) => a.date - b.date);
  const conteneur = e.kind === 'ETAGE' || e.kind === 'BATIMENT';
  return ok({
    boitiers: conteneur || !voitBoitiers(user) ? [] : hs.map((h) => ({ id: h.boitier.id, name: h.boitier.name, points: h.mesures.map(point) })),
    salles: conteneur
      ? descendants(e)
          .filter((d) => d.kind === 'SALLE')
          .sort(ordre)
          .map((s) => {
            const ids = new Set(boitiersSous(s).map((b) => b.id));
            return { id: s.id, name: s.name, points: moyenneGlissante(hs.filter((h) => ids.has(h.boitier.id))).map(point) };
          })
          .filter((s) => s.points.length)
      : [],
    moyenne: moyenneGlissante(hs).map(point),
    consignes: periodeConsignes.map(point),
  });
});
route('GET', '/api/climat/moyennes', 'auth', ({ q, perim }) => {
  const per = periode(q);
  if (!per) return erreur(400, 'start and end must be ISO-8601 instants, start before end');
  const r = {};
  for (const i of (q.get('ids') ?? '').split(',').map(Number).filter(Boolean)) {
    const e = elementParId(i);
    if (e && peutVoir(perim, e)) r[i] = moyenneGlissante(historique(e, per[0], per[1])).map(point);
  }
  return ok(r);
});
route('PUT', '/api/climat/{id}/consigne', 'GESTIONNAIRE', ({ p, corps, perim }) => {
  const e = elementParId(+p.id);
  if (!e || !peutVoir(perim, e)) return vide(404);
  if (e.kind === 'BOITIER') return erreur(400, 'Une consigne se règle sur un bâtiment, un étage ou une salle');
  const c = json(corps) ?? {};
  if (typeof c.value !== 'number') return erreur(400, 'value is required');
  if (c.value > 35) return erreur(400, `Consigne trop haute : ${c.value} °C (35 °C au plus)`);
  if (c.value < 5) return erreur(400, `Consigne impossible : ${c.value} °C (5 °C au moins)`);
  const propres = consignesPropres(e);
  const date = Date.now();
  temperature('consigne', c.value, date, e.id);
  const remplacees = [];
  if (c.force) for (const x of propres) (temperature('consigne', c.value, date, x.source.id), remplacees.push(elementDto(x.source)));
  const gardent = c.force ? new Set() : new Set(propres.flatMap((x) => [x.source.id, ...descendants(x.source).map((d) => d.id)]));
  return ok({
    conservees: c.force ? [] : propres.map(consigneDto),
    remplacees,
    boitiers: boitiersSous(e).filter((b) => !gardent.has(b.id)).map((b) => elementDto(b)),
    echecs: [],
  });
});

// ---- favourites
route('GET', '/api/favoris', 'auth', ({ user, perim }) => ok([...(favoris.get(user.id) ?? [])].filter((i) => peutVoir(perim, elementParId(i)))));
route('PUT', '/api/favoris/{id}', 'auth', ({ p, user, perim }) => {
  const e = elementParId(+p.id);
  if (!e || !peutVoir(perim, e)) return vide(404);
  if (e.kind !== 'SALLE') return erreur(400, 'Only a salle can be a favourite');
  if (!favoris.has(user.id)) favoris.set(user.id, new Set());
  favoris.get(user.id).add(e.id);
  return vide();
});
route('DELETE', '/api/favoris/{id}', 'auth', ({ p, user }) => (favoris.get(user.id)?.delete(+p.id), vide()));

// ---- temperatures (entities: dates as Jackson arrays)
const temperatureDto = (t) => ({ id: t.id, value: t.value, date: tableauDate(t.date) });
const autorisees = (perim) => temperatures.filter((t) => peutVoir(perim, elementParId(t.salle)));
route('GET', '/api/temperatures', 'auth', ({ perim }) => ok(autorisees(perim).map(temperatureDto)));
route('GET', '/api/temperatures/type/{type}', 'auth', ({ p, perim }) => {
  if (!['consigne', 'mesurer'].includes(p.type)) return ok(null);
  return ok(autorisees(perim).filter((t) => t.type === p.type).map(temperatureDto));
});
route('POST', '/api/temperatures/type/{type}', 'ADMIN', ({ p, corps }) => {
  const c = json(corps) ?? {};
  if (!['consigne', 'mesurer'].includes(p.type)) return vide(404);
  if (typeof c.value !== 'number') return erreur(400, 'value is required');
  temperature(p.type, c.value, c.date ? Date.parse(c.date) : Date.now(), null);
  return vide(201);
});
route('PUT', '/api/temperatures/{id}', 'ADMIN', ({ p, corps }) => {
  const t = temperatures.find((x) => x.id === +p.id);
  const c = json(corps) ?? {};
  if (t) {
    if (typeof c.value === 'number') t.value = c.value;
    if (c.date) t.date = Array.isArray(c.date) ? new Date(c.date[0], c.date[1] - 1, c.date[2], c.date[3] ?? 0, c.date[4] ?? 0).getTime() : Date.parse(c.date);
  }
  return vide();
});
route('DELETE', '/api/temperatures/{id}', 'ADMIN', ({ p }) => {
  const i = temperatures.findIndex((x) => x.id === +p.id);
  if (i >= 0) temperatures.splice(i, 1);
  return vide();
});

// ---- updates (a corrective is out)
const versionCorrective = {
  version: '26.10.3',
  type: 'CORRECTIVE',
  typeLabel: 'Corrective',
  recommended: true,
  prerelease: false,
  channel: 'stable',
  older: false,
  title: '26.10.3',
  publishedAt: new Date(maintenant - 2 * JOUR).toISOString(),
  url: 'https://github.com/IbraxTheKing/ThermoBox/releases',
  notes: '## Corrections\n- Les consignes héritées s’affichent dans **Gérer**\n- Boîtiers MQTT : reconnexion après une coupure du broker\n\nVoir https://github.com/IbraxTheKing/ThermoBox/pull/52',
  migration: null,
  incompatible: false,
};
const etatMaj = {
  component: 'REST',
  installedVersion: '26.10.2',
  channel: 'STABLE',
  dailyCheck: true,
  lastCheck: new Date(maintenant - 3 * HEURE).toISOString(),
  error: null,
  updateAvailable: true,
  latestPatch: versionCorrective,
  latestFeature: null,
  available: [versionCorrective],
  olderVersions: [],
  automaticInstall: false,
  installMode: 'Serveur de démonstration : rien n’est installé.',
  installation: null,
};
route('GET', '/api/updates', 'auth', ({ user }) => ok(user.type === 'ADMIN' ? etatMaj : { ...etatMaj, error: null, automaticInstall: null, installMode: null, installation: null }));
route('POST', '/api/updates/check', 'ADMIN', () => ok({ ...etatMaj, lastCheck: new Date().toISOString() }));
route('GET', '/api/updates/{version}', 'ADMIN', ({ p }) =>
  p.version === versionCorrective.version
    ? ok({
        version: versionCorrective,
        installedVersion: '26.10.2',
        installable: false,
        checks: [
          { level: 'OK', title: 'Même série mensuelle', detail: 'Corrections seulement : la base de données n’est pas modifiée.' },
          { level: 'BLOQUANT', title: 'Installation automatique impossible', detail: 'Serveur de démonstration.' },
        ],
        backupRequired: false,
        simpleRollback: true,
        confirmationRequired: false,
      })
    : { statut: 404, corps: { status: 404, message: `Version inconnue : ${p.version}` } },
);

// ---- settings
route('GET', '/api/reglages', 'auth', () => ok(reglages));
route('PUT', '/api/reglages', 'ADMIN', ({ corps }) => {
  const s = json(corps)?.style;
  if (!['verre', 'panneau'].includes(s)) return erreur(400, 'style must be one of verre, panneau');
  reglages.style = s;
  return ok(reglages);
});

// ================================================================ server

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' };

async function statique(chemin, res) {
  const racine = resolve(APP);
  let fichier = normalize(join(racine, decodeURIComponent(chemin)));
  if (!fichier.startsWith(racine)) return false;
  try {
    if ((await stat(fichier)).isDirectory()) fichier = join(fichier, 'index.html');
  } catch {
    fichier = join(racine, 'index.html'); // routes of the app
  }
  try {
    const data = await readFile(fichier);
    res.writeHead(200, { 'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream' });
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
    if (APP && (await statique(url.pathname, res))) return;
    return res.writeHead(404).end();
  }
  const corps = await lireCorps(req);
  for (const r of routes) {
    if (r.methode !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const ctx = { req, corps, q: url.searchParams, p: m.groups ?? {} };
    if (r.role !== 'public') {
      const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const session = token && jetons.get(token);
      const user = session && Date.parse(session.expiresAt) > Date.now() && users.find((u) => u.id === session.userId);
      if (!user) return envoyer(res, erreur(401, token ? 'Invalid or expired token' : 'Missing bearer token'));
      const roleOk = r.role === 'auth' || user.type === 'ADMIN' || (r.role === 'GESTIONNAIRE' && user.type === 'GESTIONNAIRE') || (r.role === 'owner' && +ctx.p.id === user.id);
      if (!roleOk) return envoyer(res, erreur(403, 'Forbidden'));
      Object.assign(ctx, { user, token, perim: perimetre(user) });
    }
    try {
      return envoyer(res, await r.f(ctx));
    } catch (e) {
      console.error(e);
      return envoyer(res, erreur(500, e.message));
    }
  }
  envoyer(res, vide(404));
}).listen(PORT, () => {
  console.log(`ThermoBox (démo) : API sur http://localhost:${PORT}/api${APP ? `, application sur http://localhost:${PORT}/` : ''}`);
  console.log('Comptes : admin / admin1234 · gestion / gestion1234 · lecteur / lecteur1234');
});

function envoyer(res, r) {
  if (r.brut) {
    res.writeHead(r.statut, { 'Content-Type': r.type, ...(r.entetes ?? {}) });
    return res.end(r.brut);
  }
  if (r.corps === undefined) return res.writeHead(r.statut).end();
  res.writeHead(r.statut, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(r.corps));
}
