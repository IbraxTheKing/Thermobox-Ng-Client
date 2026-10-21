import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { LoginResponse, User, UserRole } from '../models/models';
import { ServeurService } from './api.config';
import { initiale } from './texte';

interface Session {
  token: string;
  expiresAt: string;
  user: User;
  serveur: string;
}

const CLE = 'tb-session';

/**
 * The logged-in user and their JWT (POST /api/auth/login). The token is kept on the device until
 * it expires or the user logs out; it is sent as "Authorization: Bearer" by authInterceptor.
 * The role rules mirror the REST resources (@RequiresRole / @RequiresAuth) and LoginBean.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly serveur = inject(ServeurService);

  private readonly session = signal<Session | null>(lire());
  private minuterie?: ReturnType<typeof setTimeout>;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly connecte = computed(() => this.session() != null);

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
    const s = this.session();
    if (s && (expiree(s) || s.serveur !== this.serveur.base())) this.oublier();
    else this.programmerExpiration();
  }

  async login(username: string, password: string): Promise<void> {
    const r = await firstValueFrom(
      this.http.post<LoginResponse>(this.serveur.url('/auth/login'), { username, password }),
    );
    const session: Session = { token: r.token, expiresAt: r.expiresAt, user: r.user, serveur: this.serveur.base() };
    this.session.set(session);
    ecrire(session);
    this.programmerExpiration();
  }

  /** Revokes the token on the server (a copy stops working too), then forgets it here. */
  async logout(): Promise<void> {
    if (this.token()) {
      try {
        await firstValueFrom(this.http.post(this.serveur.url('/auth/logout'), null));
      } catch {
        /* already expired or server unreachable: forgotten anyway */
      }
    }
    this.oublier();
    await this.router.navigateByUrl('/login');
  }

  /** The server refused the token (expired, revoked, account deleted): back to the login page. */
  expiree(): void {
    if (!this.session()) return;
    this.oublier();
    void this.router.navigate(['/login'], { queryParams: { session: 'expiree' } });
  }

  /** Reloads the user from the server (role or name changed meanwhile). */
  async rafraichirUtilisateur(): Promise<void> {
    const s = this.session();
    if (!s) return;
    const user = await firstValueFrom(this.http.get<User>(this.serveur.url('/auth/me')));
    const maj = { ...s, user };
    this.session.set(maj);
    ecrire(maj);
  }

  /** After a change of one's own profile. */
  majUtilisateur(user: User): void {
    const s = this.session();
    if (!s) return;
    const maj = { ...s, user: { ...s.user, ...user } };
    this.session.set(maj);
    ecrire(maj);
  }

  estMoi(user: { id?: number | null } | null | undefined): boolean {
    return user?.id != null && user.id === this.user()?.id;
  }

  oublier(): void {
    clearTimeout(this.minuterie);
    this.session.set(null);
    ecrire(null);
  }

  private programmerExpiration(): void {
    clearTimeout(this.minuterie);
    const s = this.session();
    if (!s) return;
    const reste = Date.parse(s.expiresAt) - Date.now();
    // setTimeout overflows past ~24.8 days: the check at the next start covers longer tokens
    if (reste > 0 && reste < 2_000_000_000) this.minuterie = setTimeout(() => this.expiree(), reste);
  }
}

function expiree(s: Session): boolean {
  const fin = Date.parse(s.expiresAt);
  return !isNaN(fin) && fin <= Date.now();
}

function lire(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLE) ?? 'null') as Session | null;
    return s?.token ? s : null;
  } catch {
    return null;
  }
}

function ecrire(s: Session | null): void {
  try {
    if (s) localStorage.setItem(CLE, JSON.stringify(s));
    else localStorage.removeItem(CLE);
  } catch {
    /* private browsing */
  }
}
