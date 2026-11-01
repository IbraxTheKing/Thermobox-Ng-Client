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
  factory: () => (Capacitor.isNativePlatform() ? environment.apiNatif : environment.apiWeb),
});

const CLE = 'tb-serveur';

/**
 * Address of the ThermoBox server this app talks to, kept on the device: ThermoBox is installed
 * by each organisation, so the mobile app can't know it in advance.
 */
@Injectable({ providedIn: 'root' })
export class ServeurService {
  private readonly parDefaut = inject(API_BASE_URL);
  private readonly choisi = signal<string | null>(lire());

  /** Base of every API URL, without trailing slash: "/api" or "https://thermobox.exemple.fr/api". */
  readonly base = computed(() => this.choisi() ?? this.parDefaut);

  /** True when no address is known yet (mobile app, first launch). */
  readonly inconnu = computed(() => !this.base());

  /** What the user typed, as shown in the field ("thermobox.exemple.fr"). */
  readonly saisie = computed(() => this.choisi() ?? '');

  /** The server as people read it: « thermobox.exemple.fr », or this site's host for "/api". */
  readonly lisible = computed(() => adresseLisible(this.base()));

  /** The default address (this site on the web; none in the mobile app). */
  get defaut(): string {
    return this.parDefaut;
  }

  url(chemin: string): string {
    return this.base() + chemin;
  }

  /**
   * Records the address typed by the user. "thermobox.lan:8080" becomes
   * "https://thermobox.lan:8080/api" ("http://" kept when typed); empty goes back to the default.
   */
  definir(saisie: string): void {
    this.utiliser(versBase(saisie));
  }

  /** Talks to [base] from now on (an API base as base() gives it; null or empty: the default). */
  utiliser(base: string | null): void {
    const v = base && base !== this.parDefaut ? base : null;
    this.choisi.set(v);
    ecrire(v);
  }

  /** Base of the API for what the user typed; empty: the default one. */
  baseDe(saisie: string): string {
    return versBase(saisie) ?? this.parDefaut;
  }
}

/**
 * API base for an address typed by the user: "thermobox.lan:8080" becomes
 * "https://thermobox.lan:8080/api" ("http://" kept when typed); null when empty.
 */
export function versBase(saisie: string): string | null {
  const brut = saisie.trim();
  if (!brut) return null;
  let url = /^https?:\/\//i.test(brut) ? brut : `https://${brut}`;
  url = url.replace(/\/+$/, '');
  if (!/\/api$/i.test(url)) url += '/api';
  return url;
}

/** « thermobox.exemple.fr:8080 » for "https://thermobox.exemple.fr:8080/api"; this site for "/api". */
export function adresseLisible(base: string | null | undefined): string {
  if (!base) return '';
  if (base.startsWith('/')) return location.host;
  return base.replace(/^https:\/\//i, '').replace(/\/api$/i, '').replace(/\/+$/, '');
}

function lire(): string | null {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

function ecrire(v: string | null): void {
  try {
    if (v) localStorage.setItem(CLE, v);
    else localStorage.removeItem(CLE);
  } catch {
    /* private browsing: kept for this session only */
  }
}

/** Convertit une Date (ou une chaîne ISO) en Instant ISO-8601 attendu par le backend (Instant.parse). */
export function toInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Message to show for a failed request: the server's when it gave one. */
export function messageErreur(err: unknown, parDefaut = 'Erreur inattendue'): string {
  if (err instanceof HttpErrorResponse) {
    const corps = err.error as { error?: string; message?: string } | string | null;
    if (corps && typeof corps === 'object') {
      if (corps.error) return corps.error;
      if (corps.message) return corps.message;
    }
    if (typeof corps === 'string' && corps.trim() && !corps.trim().startsWith('<')) return corps.trim();
    if (err.status === 0) return 'Le serveur ThermoBox ne répond pas';
    if (err.status === 403) return 'Action non autorisée';
    if (err.status === 404) return 'Élément introuvable';
    return `${parDefaut} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return parDefaut;
}
