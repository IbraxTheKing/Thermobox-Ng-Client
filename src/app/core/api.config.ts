import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { environment } from '../../environments/environment';

/**
 * Default address of the ThermoBox REST API, before the user has chosen one on the login page.
 * On the web the app is usually served next to the API (or behind `ng serve`'s proxy): "/api".
 * In the mobile app there is no such neighbour: the address is asked on the login page.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => (Capacitor.isNativePlatform() ? environment.apiNative : environment.apiWeb),
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

  url(path: string): string {
    return this.base() + path;
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

/** A Date (or an ISO string) as the ISO-8601 Instant the backend expects (Instant.parse). */
export function toInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Message to show for a failed request: the server's when it gave one. */
export function errorMessage(err: unknown, fallback = 'Erreur inattendue'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string; message?: string } | string | null;
    if (body && typeof body === 'object') {
      if (body.error) return body.error;
      if (body.message) return body.message;
    }
    if (typeof body === 'string' && body.trim() && !body.trim().startsWith('<')) return body.trim();
    if (err.status === 0) return 'Le serveur ThermoBox ne répond pas';
    if (err.status === 403) return 'Action non autorisée';
    if (err.status === 404) return 'Élément introuvable';
    return `${fallback} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
