import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { LoginResponse, User, UserRole } from '../models/models';
import { ServeurService, adresseLisible } from './api.config';
import { initiale } from './texte';

/**
 * An account this device has logged in to: a user on a ThermoBox server. Kept after logging out
 * (without its token), so the user can come back to it, or switch between their accounts (at home,
 * at work…) in one tap.
 */
export interface Compte {
  /** "<API base>|<username>" */
  cle: string;
  /** API base of the server ("/api", "https://thermobox.exemple.fr/api"). */
  serveur: string;
  user: User;
  /** null: logged out (or expired), the password is asked again. */
  token: string | null;
  expiresAt: string | null;
  /** Last use (ms), most recent first in the lists. */
  vu: number;
}

const CLE_COMPTES = 'tb-comptes';
const CLE_ACTIF = 'tb-compte-actif';
/** One account only, before saved accounts (migrated on first start). */
const CLE_ANCIENNE = 'tb-session';

export function cleCompte(serveur: string, username: string): string {
  return `${serveur}|${username.toLowerCase()}`;
}

/** The account can be opened without its password. */
export function ouvrable(c: Compte): boolean {
  if (!c.token) return false;
  const fin = c.expiresAt ? Date.parse(c.expiresAt) : NaN;
  return isNaN(fin) || fin > Date.now();
}

/**
 * The logged-in user and their JWT (POST /api/auth/login), among the accounts saved on this
 * device. Tokens are kept until they expire or the user logs out; the token of the current account
 * is sent as "Authorization: Bearer" by authInterceptor. The role rules mirror the REST resources
 * (@RequiresRole / @RequiresAuth) and LoginBean.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly serveur = inject(ServeurService);

  private readonly liste = signal<Compte[]>(lireComptes());
  private readonly actif = signal<string | null>(lireActif());
  private minuterie?: ReturnType<typeof setTimeout>;

  /** Saved accounts, most recently used first. */
  readonly comptes = computed(() => [...this.liste()].sort((a, b) => b.vu - a.vu));
  /** The current account (logged in). */
  readonly compte = computed(() => {
    const c = this.liste().find((x) => x.cle === this.actif());
    return c?.token ? c : null;
  });
  /** Key of the current account: what was loaded for another one must go (stores, caches). */
  readonly cle = computed(() => this.compte()?.cle ?? null);

  readonly user = computed(() => this.compte()?.user ?? null);
  readonly token = computed(() => this.compte()?.token ?? null);
  readonly connecte = computed(() => this.compte() != null);
  /** Server of the current account, as people read it. */
  readonly adresse = computed(() => adresseLisible(this.compte()?.serveur));

  readonly role = computed<UserRole | null>(() => this.user()?.type ?? null);
  readonly admin = computed(() => this.role() === 'ADMIN');
  /** Like hasRole("GESTIONNAIRE") in REST: an ADMIN is also a GESTIONNAIRE. */
  readonly gestionnaire = computed(() => this.role() === 'ADMIN' || this.role() === 'GESTIONNAIRE');
  /** PUT /api/climat/{id}/consigne: ADMIN or GESTIONNAIRE. */
  readonly peutReglerConsigne = this.gestionnaire;
  /** Boxes are hardware: VIEWERs only see bâtiments, étages, salles and their temperatures. */
  readonly voitBoitiers = this.gestionnaire;
  readonly initiale = computed(() => initiale(this.user()?.username));

  constructor() {
    const c = this.liste().find((x) => x.cle === this.actif());
    if (!c || !ouvrable(c)) {
      if (c) this.modifier(c.cle, { token: null, expiresAt: null });
      this.definirActif(null);
    } else {
      // The app talks to the server of the current account
      if (c.serveur !== this.serveur.base()) this.serveur.utiliser(c.serveur);
      this.programmerExpiration();
    }
  }

  /** Logs in on [base] (default: the current server); the account becomes the current one. */
  async login(username: string, password: string, base = this.serveur.base()): Promise<void> {
    const r = await firstValueFrom(this.http.post<LoginResponse>(`${base}/auth/login`, { username, password }));
    const cle = cleCompte(base, r.user.username ?? username);
    const compte: Compte = { cle, serveur: base, user: r.user, token: r.token, expiresAt: r.expiresAt, vu: Date.now() };
    this.liste.update((l) => [...l.filter((x) => x.cle !== cle), compte]);
    this.serveur.utiliser(base);
    this.definirActif(cle);
    this.sauver();
    this.programmerExpiration();
  }

  /** Revokes the token on the server (a copy stops working too); the account stays saved. */
  async logout(): Promise<void> {
    const c = this.compte();
    if (c) {
      await this.revoquer(c);
      this.modifier(c.cle, { token: null, expiresAt: null });
    }
    this.fermer();
    // The login page lists the saved accounts, this one among them
    await this.router.navigateByUrl('/login');
  }

  /**
   * Opens another saved account. Its token still valid: the app starts again on its dashboard
   * (nothing of the previous account or server stays in memory). Otherwise its password is asked.
   */
  async basculer(cle: string): Promise<void> {
    const c = this.liste().find((x) => x.cle === cle);
    if (!c) return;
    if (!ouvrable(c)) {
      await this.router.navigate(['/login'], { queryParams: { compte: cle } });
      return;
    }
    this.modifier(cle, { vu: Date.now() });
    this.serveur.utiliser(c.serveur);
    this.definirActif(cle);
    this.sauver();
    location.assign(new URL('app/apercu', document.baseURI).href);
  }

  /** Removes a saved account from this device (logged out on its server first). */
  async oublierCompte(cle: string): Promise<void> {
    const c = this.liste().find((x) => x.cle === cle);
    if (!c) return;
    const courant = this.actif() === cle && c.token != null;
    await this.revoquer(c);
    this.liste.update((l) => l.filter((x) => x.cle !== cle));
    if (this.actif() === cle) this.definirActif(null);
    this.sauver();
    if (courant) {
      clearTimeout(this.minuterie);
      await this.router.navigateByUrl('/login');
    }
  }

  /** The server refused the token (expired, revoked, account deleted): back to the login page. */
  expiree(): void {
    const c = this.compte();
    if (!c) return;
    this.modifier(c.cle, { token: null, expiresAt: null });
    this.fermer();
    void this.router.navigate(['/login'], { queryParams: { session: 'expiree', compte: c.cle } });
  }

  /** Reloads the user from the server (role or name changed meanwhile). */
  async rafraichirUtilisateur(): Promise<void> {
    const c = this.compte();
    if (!c) return;
    const user = await firstValueFrom(this.http.get<User>(this.serveur.url('/auth/me')));
    this.modifier(c.cle, { user });
    this.sauver();
  }

  /** After a change of one's own profile. */
  majUtilisateur(user: User): void {
    const c = this.compte();
    if (!c) return;
    this.modifier(c.cle, { user: { ...c.user, ...user } });
    this.sauver();
  }

  estMoi(user: { id?: number | null } | null | undefined): boolean {
    return user?.id != null && user.id === this.user()?.id;
  }

  /** The current account is closed on this device (deleted account): forgotten. */
  oublier(): void {
    const cle = this.actif();
    clearTimeout(this.minuterie);
    if (cle) this.liste.update((l) => l.filter((x) => x.cle !== cle));
    this.definirActif(null);
    this.sauver();
  }

  private fermer(): void {
    clearTimeout(this.minuterie);
    this.definirActif(null);
    this.sauver();
  }

  /** POST /auth/logout with the account's own token, on its own server. */
  private async revoquer(c: Compte): Promise<void> {
    if (!c.token) return;
    try {
      await firstValueFrom(this.http.post(`${c.serveur}/auth/logout`, null, { headers: { Authorization: `Bearer ${c.token}` } }));
    } catch {
      /* already expired or server unreachable: forgotten anyway */
    }
  }

  private modifier(cle: string, champs: Partial<Compte>): void {
    this.liste.update((l) => l.map((x) => (x.cle === cle ? { ...x, ...champs } : x)));
  }

  private definirActif(cle: string | null): void {
    this.actif.set(cle);
  }

  private sauver(): void {
    try {
      localStorage.setItem(CLE_COMPTES, JSON.stringify(this.liste()));
      const a = this.actif();
      if (a) localStorage.setItem(CLE_ACTIF, a);
      else localStorage.removeItem(CLE_ACTIF);
    } catch {
      /* private browsing: kept for this session only */
    }
  }

  private programmerExpiration(): void {
    clearTimeout(this.minuterie);
    const c = this.compte();
    if (!c?.expiresAt) return;
    const reste = Date.parse(c.expiresAt) - Date.now();
    // setTimeout overflows past ~24.8 days: the check at the next start covers longer tokens
    if (reste > 0 && reste < 2_000_000_000) this.minuterie = setTimeout(() => this.expiree(), reste);
  }
}

function lireComptes(): Compte[] {
  try {
    const l = JSON.parse(localStorage.getItem(CLE_COMPTES) ?? 'null') as Compte[] | null;
    if (Array.isArray(l)) return l.filter((c) => c?.cle && c.serveur && c.user);
    // Before saved accounts: the one session becomes the first account
    const s = JSON.parse(localStorage.getItem(CLE_ANCIENNE) ?? 'null') as { token: string; expiresAt: string; user: User; serveur: string } | null;
    localStorage.removeItem(CLE_ANCIENNE);
    if (!s?.token || !s.user) return [];
    const cle = cleCompte(s.serveur, s.user.username ?? '');
    const compte: Compte = { cle, serveur: s.serveur, user: s.user, token: s.token, expiresAt: s.expiresAt, vu: Date.now() };
    localStorage.setItem(CLE_COMPTES, JSON.stringify([compte]));
    localStorage.setItem(CLE_ACTIF, cle);
    return [compte];
  } catch {
    return [];
  }
}

function lireActif(): string | null {
  try {
    return localStorage.getItem(CLE_ACTIF);
  } catch {
    return null;
  }
}

/**
 * Runs [vider] whenever the current account changes (logout, another account): what a root store
 * loaded for one account must never show for another. Call in an injection context.
 */
export function surChangementDeCompte(vider: () => void): void {
  const auth = inject(AuthService);
  let avant = auth.cle();
  effect(() => {
    const cle = auth.cle();
    if (cle === avant) return;
    avant = cle;
    untracked(vider);
  });
}
