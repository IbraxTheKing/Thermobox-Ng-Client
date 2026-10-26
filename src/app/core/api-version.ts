import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, from, map, switchMap } from 'rxjs';

/**
 * The two REST APIs of ThermoBox:
 * - v1, `/api/…` with French names (`/api/hierarchie/arbre`, `{"noeuds": …}`, `"BATIMENT"`), the
 *   only one before 26.12;
 * - v2, `/api/v2/…` in English (`/api/v2/hierarchy/tree`, `{"nodes": …}`, `"BUILDING"`), since
 *   26.12, which still answers v1 for older clients.
 *
 * The services of this client are written against v2. For a server that only has v1, the
 * interceptor below rewrites each request to its v1 path and translates the JSON both ways, as the
 * server itself does for old clients (RestServer LegacyApi.kt). What only v2 has (server logo,
 * temperature limits) is offered only when the server says it has v2.
 *
 * GET /api/server (public) tells which: `"apiVersions": ["v1"]` in 26.11, `["v1", "v2"]` since
 * 26.12; a server before 26.11 answers 404.
 */

/** GET /api/v2/server (or /api/server, with the same keys). */
export interface ServerInfo {
  name: string;
  version: string;
  apiVersions: string[];
  /** Path of the logo on the server ("/api/v2/server/logo?v=…"), v2 only. */
  logo?: string | null;
  /** "custom" (given by an ADMIN), "site" (of the website the server belongs to), "default". */
  logoSource?: string | null;
}

export interface ServerApi {
  /** The server answers /api/v2. */
  v2: boolean;
  /** null: a server before 26.11 (or not reached). */
  info: ServerInfo | null;
}

/** First segment after `api/`: v2 → v1. */
const ROOTS: Record<string, string> = {
  climate: 'climat',
  favorites: 'favoris',
  hierarchy: 'hierarchie',
  rooms: 'salles',
  roomtemps: 'salletemps',
  settings: 'reglages',
};

/** Later segments: v2 → v1. */
const SEGMENTS: Record<string, string> = {
  history: 'historique',
  averages: 'moyennes',
  setpoint: 'consigne',
  setpoints: 'consignes',
  measurement: 'mesurer',
  tree: 'arbre',
  access: 'acces',
};

/** Segments followed by a free value (a user or room name), never translated. */
const BEFORE_FREE_VALUE = new Set(['username', 'name']);

/** JSON keys, v2 → v1. */
const KEYS: Record<string, string> = {
  all: 'tout',
  ancestors: 'ancetres',
  attached: 'rattache',
  average: 'moyenne',
  children: 'enfants',
  devices: 'boitiers',
  devicesVisible: 'boitiersVisibles',
  failures: 'echecs',
  favorite: 'favori',
  inherited: 'heritee',
  kept: 'conservees',
  lastMeasurement: 'derniereMesure',
  measurements: 'mesures',
  nodes: 'noeuds',
  ownSetpoints: 'consignesPropres',
  replaced: 'remplacees',
  room: 'salle',
  rooms: 'salles',
  setpoint: 'consigne',
  setpoints: 'consignes',
};

/** Values of some keys (named after the v2 key), v2 → v1. */
const VALUES: Record<string, Record<string, string>> = {
  kind: { BUILDING: 'BATIMENT', FLOOR: 'ETAGE', ROOM: 'SALLE', DEVICE: 'BOITIER' },
  type: { MANAGER: 'GESTIONNAIRE', PATCH: 'CORRECTIVE', FEATURE: 'FONCTIONNELLE' },
  state: { PENDING: 'EN_ATTENTE', RUNNING: 'EN_COURS', SKIPPED: 'IGNOREE', FAILED: 'ECHEC', RESTARTING: 'REDEMARRAGE', DONE: 'TERMINEE' },
  level: { WARNING: 'AVERTISSEMENT', BLOCKING: 'BLOQUANT' },
  style: { glass: 'verre', panel: 'panneau' },
  typeLabel: { Patch: 'Corrective', Feature: 'Fonctionnelle' },
};

const KEYS_IN = Object.fromEntries(Object.entries(KEYS).map(([en, fr]) => [fr, en]));
// Lower case: v1 servers wrote some values in any case
const VALUES_IN = Object.fromEntries(
  Object.entries(VALUES).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([en, fr]) => [fr.toLowerCase(), en]))]),
);

/** `climate/3/setpoint` → `climat/3/consigne` (path after `/v2/`). */
export function legacyPath(path: string): string {
  const s = path.split('/');
  return s
    .map((x, i) => (i === 0 ? (ROOTS[x] ?? x) : BEFORE_FREE_VALUE.has(s[i - 1]) ? x : (SEGMENTS[x] ?? x)))
    .join('/');
}

/** JSON of v2 → JSON of v1 (out: true), or back. */
export function translate(value: unknown, out: boolean, key: string | null = null): unknown {
  if (Array.isArray(value)) return value.map((v) => translate(v, out, key));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const nk = (out ? KEYS[k] : KEYS_IN[k]) ?? k;
      // Value maps are named after the v2 key
      r[nk] = translate(v, out, out ? k : nk);
    }
    return r;
  }
  if (typeof value === 'string' && key) {
    const m = out ? VALUES[key]?.[value] : VALUES_IN[key]?.[value.toLowerCase()];
    return m ?? value;
  }
  return value;
}

const STORE = 'tb-servers';

/** What each server said about itself, kept on the device (logo and name in the account lists). */
function readStore(): Record<string, ServerApi> {
  try {
    return (JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, ServerApi>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Which API each server answers (by API base, "/api" or "https://thermobox.example.com/api"),
 * asked once per launch of the app, and again after logging in.
 */
@Injectable({ providedIn: 'root' })
export class ApiVersionService {
  // Without the interceptors: the question must not wait for its own answer
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly pending = new Map<string, Promise<ServerApi>>();
  /** Known servers, saved: their logo and name show in the account lists before any request. */
  readonly known = signal<Record<string, ServerApi>>(readStore());

  /** What is known of [base] right now (null: not asked yet). */
  of(base: string): ServerApi | null {
    return this.known()[base] ?? null;
  }

  /** v2 for [base]: asked first if not yet done during this launch. */
  api(base: string): Promise<ServerApi> {
    let p = this.pending.get(base);
    if (!p) {
      p = this.ask(base);
      this.pending.set(base, p);
    }
    return p;
  }

  /** Asks [base] again (after logging in, after an update of the server). */
  refresh(base: string): Promise<ServerApi> {
    this.pending.delete(base);
    return this.api(base);
  }

  /** The logo of [base] as an image URL ([size]: largest side in pixels), null without v2. */
  logo(base: string, size = 96): string | null {
    const s = this.of(base);
    const path = s?.v2 ? s.info?.logo : null;
    if (!path) return null;
    // The logo path starts with /api: put it after the base, whatever is before /api on the server
    const url = base.replace(/\/api$/i, '') + path;
    return url + (url.includes('?') ? '&' : '?') + `size=${size}`;
  }

  /** The server changed its logo (PUT / DELETE …/logo give the new GET /server). */
  update(base: string, info: ServerInfo): void {
    this.save(base, { v2: info.apiVersions?.includes('v2') ?? false, info });
  }

  private async ask(base: string): Promise<ServerApi> {
    try {
      const info = await firstValueFrom(this.http.get<ServerInfo>(`${base}/server`));
      const r: ServerApi = { v2: !!info?.apiVersions?.includes('v2'), info: info ?? null };
      this.save(base, r);
      return r;
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status >= 400 && e.status < 500) {
        // Before 26.11: no /api/server, v1 only
        const r: ServerApi = { v2: false, info: null };
        this.save(base, r);
        return r;
      }
      // Not reached: what was known, else v1, which every server answers; asked again later
      setTimeout(() => this.pending.delete(base), 30_000);
      return this.of(base) ?? { v2: false, info: null };
    }
  }

  private save(base: string, r: ServerApi): void {
    const all = { ...this.known(), [base]: r };
    this.known.set(all);
    try {
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch {
      /* kept for this launch */
    }
  }
}

const V2 = /^(.*?)\/v2\/(.*)$/;

/**
 * Requests to `<base>/v2/…`: sent as they are to a v2 server; rewritten to `<base>/…` with French
 * names, and their JSON translated both ways, for a v1 server.
 */
export const apiVersionInterceptor: HttpInterceptorFn = (req, next) => {
  const m = V2.exec(req.url.split('?')[0]);
  if (!m) return next(req);
  const base = m[1];
  const versions = inject(ApiVersionService);
  return from(versions.api(base)).pipe(
    switchMap((s) => {
      if (s.v2) return next(req);
      const query = req.url.slice(req.url.split('?')[0].length);
      const legacy: HttpRequest<unknown> = req.clone({
        url: `${base}/${legacyPath(m[2])}${query}`,
        body: isJson(req.body) ? translate(req.body, true) : req.body,
      });
      return next(legacy).pipe(
        map((e) => (e instanceof HttpResponse && isJson(e.body) ? e.clone({ body: translate(e.body, false) }) : e)),
      );
    }),
  );
};

function isJson(body: unknown): boolean {
  return Array.isArray(body) || (!!body && typeof body === 'object' && Object.getPrototypeOf(body) === Object.prototype);
}
