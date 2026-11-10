import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { environment } from '../../environments/environment';
import { TARGET } from '../../platforms/current';

/**
 * Default address of the ThermoBox REST API, before the user has chosen one on the login page.
 * On the web the app is usually served next to the API (or behind `ng serve`'s proxy): "/api".
 * In the mobile app there is no such neighbour: the address is asked on the login page.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  // The apps (iOS, Android, desktop) have no server next to them: the address is asked
  factory: () => (Capacitor.isNativePlatform() || TARGET.desktopOs ? environment.apiNative : environment.apiWeb),
});

const KEY = 'tb-server';

/**
 * Address of the ThermoBox server this app talks to, kept on the device: ThermoBox is installed
 * by each organisation, so the mobile app can't know it in advance.
 */
@Injectable({ providedIn: 'root' })
export class ServerService {
  private readonly fallback = inject(API_BASE_URL);
  private readonly chosen = signal<string | null>(read());

  /** Base of every API URL, without trailing slash: "/api" or "https://thermobox.exemple.fr/api". */
  readonly base = computed(() => this.chosen() ?? this.fallback);

  /** True when no address is known yet (mobile app, first launch). */
  readonly unknown = computed(() => !this.base());

  /** What the user typed, as shown in the field ("thermobox.exemple.fr"). */
  readonly input = computed(() => this.chosen() ?? '');

  /** The server as people read it: « thermobox.exemple.fr », or this site's host for "/api". */
  readonly readable = computed(() => readableAddress(this.base()));

  /** The default address (this site on the web; none in the mobile app). */
  get defaultBase(): string {
    return this.fallback;
  }

  /** URL of [path] in the v2 API ("/hierarchy/tree"); sent to a v1 server as its v1 equivalent. */
  url(path: string): string {
    return apiUrl(this.base(), path);
  }

  /**
   * Records the address typed by the user. "thermobox.lan:8080" becomes
   * "https://thermobox.lan:8080/api" ("http://" kept when typed); empty goes back to the default.
   */
  set(input: string): void {
    this.use(toBase(input));
  }

  /** Talks to [base] from now on (an API base as base() gives it; null or empty: the default). */
  use(base: string | null): void {
    const v = base && base !== this.fallback ? base : null;
    this.chosen.set(v);
    write(v);
  }

  /** Base of the API for what the user typed; empty: the default one. */
  baseOf(input: string): string {
    return toBase(input) ?? this.fallback;
  }
}

/**
 * API base for an address typed by the user: "thermobox.lan:8080" becomes
 * "https://thermobox.lan:8080/api" ("http://" kept when typed); null when empty.
 */
export function toBase(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  url = url.replace(/\/+$/, '');
  if (!/\/api$/i.test(url)) url += '/api';
  return url;
}

/** « thermobox.exemple.fr:8080 » for "https://thermobox.exemple.fr:8080/api"; this site for "/api". */
export function readableAddress(base: string | null | undefined): string {
  if (!base) return '';
  if (base.startsWith('/')) return location.host;
  return base.replace(/^https:\/\//i, '').replace(/\/api$/i, '').replace(/\/+$/, '');
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(v: string | null): void {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* private browsing: kept for this session only */
  }
}

/** URL of [path] in the v2 API of the server at [base] (see ApiVersionService). */
export function apiUrl(base: string, path: string): string {
  return `${base}/v2${path}`;
}

/** A Date (or an ISO string) as the ISO-8601 Instant the backend expects (Instant.parse). */
export function toInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Message to show for a failed request: the server's when it gave one. */
/**
 * No answer from the server at [url]. In a browser, an HTTPS server with a certificate the
 * browser does not know (self-signed, ThermoBox 26.12) gives the same silence: the page cannot
 * see why, nor accept it; the browser can, once its address is opened in a tab. The desktop apps
 * ask themselves (platforms/desktop/tls.ts).
 */
function unreachable(url: string | null | undefined, cause?: unknown): string {
  const message = $localize`Le serveur ThermoBox ne répond pas`;
  // The desktop apps know why (tls.ts: a certificate refused, a connection refused…)
  if (TARGET.desktopOs) {
    const why = cause instanceof Error ? cause.message.trim() : '';
    return why && !/^(Failed to fetch|Load failed|NetworkError)/i.test(why) ? `${message} (${why})` : message;
  }
  if (TARGET.name !== 'web' || !url) return message;
  try {
    const u = new URL(url, location.href);
    if (u.protocol !== 'https:' || u.origin === location.origin) return message;
    return message + ' ' + $localize`(ou son certificat n'est pas reconnu par le navigateur : ouvre ${u.origin}:origin: dans un nouvel onglet, accepte le certificat après avoir comparé son empreinte à celle du serveur, puis réessaie)`;
  } catch {
    return message;
  }
}

export function errorMessage(err: unknown, fallback = $localize`Erreur inattendue`): string {
  if (err instanceof HttpErrorResponse) {
    // No answer at all (offline, wrong address, refused): the network error says nothing more
    if (err.status === 0 && (err.error == null || err.error instanceof Error || err.error instanceof ProgressEvent)) return unreachable(err.url, err.error);
    const body = err.error as { error?: string; message?: string } | string | null;
    if (body && typeof body === 'object') {
      if (body.error) return body.error;
      if (body.message) return body.message;
    }
    if (typeof body === 'string' && body.trim() && !body.trim().startsWith('<')) return body.trim();
    if (err.status === 0) return unreachable(err.url);
    if (err.status === 403) return $localize`Action non autorisée`;
    if (err.status === 404) return $localize`Élément introuvable`;
    return `${fallback} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
