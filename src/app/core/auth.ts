import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { LoginResponse, User, UserRole } from '../models/models';
import { ApiVersionService } from './api-version';
import { ServerService, apiUrl, readableAddress } from './api.config';
import { initial } from './text';

/**
 * An account this device has logged in to: a user on a ThermoBox server. Kept after logging out
 * (without its token), so the user can come back to it, or switch between their accounts (at home,
 * at work…) in one tap.
 */
export interface Account {
  /** "<API base>|<username>" */
  key: string;
  /** API base of the server ("/api", "https://thermobox.exemple.fr/api"). */
  server: string;
  user: User;
  /** null: logged out (or expired), the password is asked again. */
  token: string | null;
  expiresAt: string | null;
  /** Last use (ms), most recent first in the lists. */
  seen: number;
}

const ACCOUNTS_KEY = 'tb-accounts';
const ACTIVE_KEY = 'tb-account-active';
/** One account only, before saved accounts (migrated on first start). */
const OLD_KEY = 'tb-session';

export function accountKey(server: string, username: string): string {
  return `${server}|${username.toLowerCase()}`;
}

/** Rows of an account list in one section per server, in the order the servers first come. */
export function byServer<T extends { account: Account }>(rows: T[]): { base: string; address: string; rows: T[] }[] {
  const groups = new Map<string, { base: string; address: string; rows: T[] }>();
  for (const r of rows) {
    const base = r.account.server;
    let g = groups.get(base);
    if (!g) groups.set(base, (g = { base, address: readableAddress(base), rows: [] }));
    g.rows.push(r);
  }
  return [...groups.values()];
}

/** The account can be opened without its password. */
export function openable(c: Account): boolean {
  if (!c.token) return false;
  const end = c.expiresAt ? Date.parse(c.expiresAt) : NaN;
  return isNaN(end) || end > Date.now();
}

/**
 * The logged-in user and their JWT (POST /api/v2/auth/login), among the accounts saved on this
 * device. Tokens are kept until they expire or the user logs out; the token of the current account
 * is sent as "Authorization: Bearer" by authInterceptor. The role rules mirror the REST resources
 * (@RequiresRole / @RequiresAuth) and LoginBean.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly server = inject(ServerService);
  private readonly versions = inject(ApiVersionService);

  private readonly list = signal<Account[]>(readAccounts());
  private readonly active = signal<string | null>(readActive());
  private timer?: ReturnType<typeof setTimeout>;

  /** Saved accounts, most recently used first. */
  readonly accounts = computed(() => [...this.list()].sort((a, b) => b.seen - a.seen));
  /** The current account (logged in). */
  readonly account = computed(() => {
    const c = this.list().find((x) => x.key === this.active());
    return c?.token ? c : null;
  });
  /** Key of the current account: what was loaded for another one must go (stores, caches). */
  readonly key = computed(() => this.account()?.key ?? null);

  readonly user = computed(() => this.account()?.user ?? null);
  readonly token = computed(() => this.account()?.token ?? null);
  readonly loggedIn = computed(() => this.account() != null);
  /** Server of the current account, as people read it. */
  readonly address = computed(() => readableAddress(this.account()?.server));

  readonly role = computed<UserRole | null>(() => this.user()?.type ?? null);
  readonly admin = computed(() => this.role() === 'ADMIN');
  /** Like hasRole("MANAGER") in REST: an ADMIN is also a MANAGER. */
  readonly manager = computed(() => this.role() === 'ADMIN' || this.role() === 'MANAGER');
  /** PUT /api/v2/climate/{id}/setpoint: ADMIN or MANAGER. */
  readonly canSetSetpoint = this.manager;
  /** Boxes are hardware: VIEWERs only see buildings, floors, rooms and their temperatures. */
  readonly seesDevices = this.manager;
  readonly initial = computed(() => initial(this.user()?.username));

  constructor() {
    const c = this.list().find((x) => x.key === this.active());
    if (!c || !openable(c)) {
      if (c) this.edit(c.key, { token: null, expiresAt: null });
      this.setActive(null);
    } else {
      // The app talks to the server of the current account
      if (c.server !== this.server.base()) this.server.use(c.server);
      this.scheduleExpiration();
    }
  }

  /** Logs in on [base] (default: the current server); the account becomes the current one. */
  async login(username: string, password: string, base = this.server.base()): Promise<void> {
    // Asked again at each login: the server may have been updated (v1 → v2) since
    await this.versions.refresh(base);
    const r = await firstValueFrom(this.http.post<LoginResponse>(apiUrl(base, '/auth/login'), { username, password }));
    const key = accountKey(base, r.user.username ?? username);
    const account: Account = { key, server: base, user: r.user, token: r.token, expiresAt: r.expiresAt, seen: Date.now() };
    this.list.update((l) => [...l.filter((x) => x.key !== key), account]);
    this.server.use(base);
    this.setActive(key);
    this.save();
    this.scheduleExpiration();
  }

  /** Revokes the token on the server (a copy stops working too); the account stays saved. */
  async logout(): Promise<void> {
    const c = this.account();
    if (c) {
      await this.revoke(c);
      this.edit(c.key, { token: null, expiresAt: null });
    }
    this.close();
    // The login page lists the saved accounts, this one among them
    await this.router.navigateByUrl('/login');
  }

  /**
   * Opens another saved account. Its token still valid: the app starts again on its dashboard
   * (nothing of the previous account or server stays in memory). Otherwise its password is asked.
   */
  async toggle(key: string): Promise<void> {
    const c = this.list().find((x) => x.key === key);
    if (!c) return;
    if (!openable(c)) {
      await this.router.navigate(['/login'], { queryParams: { account: key } });
      return;
    }
    this.edit(key, { seen: Date.now() });
    this.server.use(c.server);
    this.setActive(key);
    this.save();
    location.assign(new URL('app/apercu', document.baseURI).href);
  }

  /** Removes a saved account from this device (logged out on its server first). */
  async forgetAccount(key: string): Promise<void> {
    const c = this.list().find((x) => x.key === key);
    if (!c) return;
    const current = this.active() === key && c.token != null;
    await this.revoke(c);
    this.list.update((l) => l.filter((x) => x.key !== key));
    if (this.active() === key) this.setActive(null);
    this.save();
    if (current) {
      clearTimeout(this.timer);
      await this.router.navigateByUrl('/login');
    }
  }

  /** The server refused the token (expired, revoked, account deleted): back to the login page. */
  expired(): void {
    const c = this.account();
    if (!c) return;
    this.edit(c.key, { token: null, expiresAt: null });
    this.close();
    void this.router.navigate(['/login'], { queryParams: { session: 'expired', account: c.key } });
  }

  /** Reloads the user from the server (role or name changed meanwhile). */
  async refreshUser(): Promise<void> {
    const c = this.account();
    if (!c) return;
    const user = await firstValueFrom(this.http.get<User>(this.server.url('/auth/me')));
    this.edit(c.key, { user });
    this.save();
  }

  /** After a change of one's own profile. */
  updateUser(user: User): void {
    const c = this.account();
    if (!c) return;
    this.edit(c.key, { user: { ...c.user, ...user } });
    this.save();
  }

  isMe(user: { id?: number | null } | null | undefined): boolean {
    return user?.id != null && user.id === this.user()?.id;
  }

  /** The current account is closed on this device (deleted account): forgotten. */
  forget(): void {
    const key = this.active();
    clearTimeout(this.timer);
    if (key) this.list.update((l) => l.filter((x) => x.key !== key));
    this.setActive(null);
    this.save();
  }

  private close(): void {
    clearTimeout(this.timer);
    this.setActive(null);
    this.save();
  }

  /** POST /auth/logout with the account's own token, on its own server. */
  private async revoke(c: Account): Promise<void> {
    if (!c.token) return;
    try {
      await firstValueFrom(this.http.post(apiUrl(c.server, '/auth/logout'), null, { headers: { Authorization: `Bearer ${c.token}` } }));
    } catch {
      /* already expired or server unreachable: forgotten anyway */
    }
  }

  private edit(key: string, fields: Partial<Account>): void {
    this.list.update((l) => l.map((x) => (x.key === key ? { ...x, ...fields } : x)));
  }

  private setActive(key: string | null): void {
    this.active.set(key);
  }

  private save(): void {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(this.list()));
      const a = this.active();
      if (a) localStorage.setItem(ACTIVE_KEY, a);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* private browsing: kept for this session only */
    }
  }

  private scheduleExpiration(): void {
    clearTimeout(this.timer);
    const c = this.account();
    if (!c?.expiresAt) return;
    const remaining = Date.parse(c.expiresAt) - Date.now();
    // setTimeout overflows past ~24.8 days: the check at the next start covers longer tokens
    if (remaining > 0 && remaining < 2_000_000_000) this.timer = setTimeout(() => this.expired(), remaining);
  }
}

function readAccounts(): Account[] {
  try {
    const l = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? 'null') as Account[] | null;
    if (Array.isArray(l)) return l.filter((c) => c?.key && c.server && c.user);
    // Before saved accounts: the one session (French keys) becomes the first account
    const s = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as { token: string; expiresAt: string; user: User; serveur: string } | null;
    localStorage.removeItem(OLD_KEY);
    if (!s?.token || !s.user) return [];
    const key = accountKey(s.serveur, s.user.username ?? '');
    const account: Account = { key, server: s.serveur, user: s.user, token: s.token, expiresAt: s.expiresAt, seen: Date.now() };
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([account]));
    localStorage.setItem(ACTIVE_KEY, key);
    return [account];
  } catch {
    return [];
  }
}

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/**
 * Runs [vider] whenever the current account changes (logout, another account): what a root store
 * loaded for one account must never show for another. Call in an injection context.
 */
export function onAccountChange(clear: () => void): void {
  const auth = inject(AuthService);
  let before = auth.key();
  effect(() => {
    const key = auth.key();
    if (key === before) return;
    before = key;
    untracked(clear);
  });
}
