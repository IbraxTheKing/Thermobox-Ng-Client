import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, finalize, throwError } from 'rxjs';

import { ServerService } from './api.config';
import { AuthService } from './auth';

/** Requests made in the background (polling every 30 s): no busy bar. */
export const DISCRETE = new HttpContextToken<boolean>(() => false);

/** Requests in progress, for the thin bar at the top of the screen. */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly inProgress = signal(0);
  readonly busy = computed(() => this.inProgress() > 0);
  start(): void {
    this.inProgress.update((n) => n + 1);
  }
  end(): void {
    this.inProgress.update((n) => Math.max(0, n - 1));
  }
}

/**
 * Adds "Authorization: Bearer <token>" to the requests sent to the ThermoBox server, and goes back
 * to the login page when the server refuses the token (401: expired, revoked, account deleted).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const server = inject(ServerService);
  const activity = inject(ActivityService);
  const token = auth.token();
  const toApi = req.url.startsWith(server.base());
  const login = req.url.endsWith('/auth/login');
  // A request that brings its own token (logging out another saved account) keeps it
  const own = req.headers.has('Authorization');
  const query = token && toApi && !login && !own ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  const discrete = req.context.get(DISCRETE);
  if (!discrete) activity.start();
  return next(query).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && toApi && !login && !own) auth.expired();
      return throwError(() => err);
    }),
    finalize(() => {
      if (!discrete) activity.end();
    }),
  );
};

/** Pages of a logged-in user. */
export const loggedInGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.loggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/**
 * Login and registration: no need to stay there once logged in, unless to add another account
 * (?ajout) or to log in again to a saved one (?compte=).
 */
export const publicGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  if (!auth.loggedIn() || route.queryParamMap.has('add') || route.queryParamMap.has('account')) return true;
  return inject(Router).createUrlTree(['/app/overview']);
};

/** MANAGER and ADMIN (Gestion page); the others go back to the dashboard. */
export const managerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.manager() ? true : inject(Router).createUrlTree(['/app/overview']);
};

/** ADMIN only (users, updates). */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.admin() ? true : inject(Router).createUrlTree(['/app/overview']);
};
