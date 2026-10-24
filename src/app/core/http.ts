import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, finalize, throwError } from 'rxjs';

import { ServeurService } from './api.config';
import { AuthService } from './auth';

/** Requests made in the background (polling every 30 s): no busy bar. */
export const DISCRETE = new HttpContextToken<boolean>(() => false);

/** Requests in progress, for the thin bar at the top of the screen. */
@Injectable({ providedIn: 'root' })
export class ActiviteService {
  private readonly enCours = signal(0);
  readonly occupe = computed(() => this.enCours() > 0);
  debut(): void {
    this.enCours.update((n) => n + 1);
  }
  fin(): void {
    this.enCours.update((n) => Math.max(0, n - 1));
  }
}

/**
 * Adds "Authorization: Bearer <token>" to the requests sent to the ThermoBox server, and goes back
 * to the login page when the server refuses the token (401: expired, revoked, account deleted).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const serveur = inject(ServeurService);
  const activite = inject(ActiviteService);
  const token = auth.token();
  const versApi = req.url.startsWith(serveur.base());
  const login = req.url.endsWith('/auth/login');
  // A request that brings its own token (logging out another saved account) keeps it
  const propre = req.headers.has('Authorization');
  const requete = token && versApi && !login && !propre ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const discrete = req.context.get(DISCRETE);
  if (!discrete) activite.debut();
  return next(requete).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && versApi && !login && !propre) auth.expiree();
      return throwError(() => err);
    }),
    finalize(() => {
      if (!discrete) activite.fin();
    }),
  );
};

/** Pages of a logged-in user. */
export const connecteGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.connecte() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * Login and registration: no need to stay there once logged in, unless to add another account
 * (?ajout) or to log in again to a saved one (?compte=).
 */
export const publicGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  if (!auth.connecte() || route.queryParamMap.has('ajout') || route.queryParamMap.has('compte')) return true;
  return inject(Router).createUrlTree(['/app/apercu']);
};

/** GESTIONNAIRE and ADMIN (Gestion page); the others go back to the dashboard. */
export const gestionnaireGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.gestionnaire() ? true : inject(Router).createUrlTree(['/app/apercu']);
};

/** ADMIN only (users, updates). */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.admin() ? true : inject(Router).createUrlTree(['/app/apercu']);
};
