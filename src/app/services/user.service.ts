import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService, apiUrl } from '../core/api.config';
import { Access, User, UserChanges } from '../models/models';

/** Angular client of the users resource — /api/v2/users */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path = ''): string {
    return this.server.url(`/users${path}`);
  }

  /** ADMIN */
  getAll(): Observable<User[]> {
    return this.http.get<User[]>(this.url());
  }

  /** ADMIN or owner of the account */
  getById(id: number): Observable<User | null> {
    return this.http.get<User | null>(this.url(`/${id}`));
  }

  /** ADMIN */
  getByUsername(username: string): Observable<User | null> {
    return this.http.get<User | null>(this.url(`/username/${encodeURIComponent(username)}`));
  }

  /**
   * Public registration (always VIEWER) — 201 when created, 409 when the name is taken. [base]: a
   * server other than the app's (registration page).
   */
  add(user: { username: string; password: string }, base?: string): Observable<void> {
    return this.http.post<void>(base ? apiUrl(base, '/users') : this.url(), user);
  }

  /** ADMIN or owner: only the fields given change; the role, ADMIN only. */
  update(id: number, changes: UserChanges): Observable<User> {
    return this.http.put<User>(this.url(`/${id}`), changes);
  }

  /** ADMIN or owner of the account */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  /** ADMIN or owner: everything, or only some buildings / floors / rooms. */
  getAccess(id: number): Observable<Access> {
    return this.http.get<Access>(this.url(`/${id}/access`));
  }

  /** ADMIN — an ADMIN account cannot be restricted. */
  setAccess(id: number, restricted: boolean, elements: number[]): Observable<Access> {
    return this.http.put<Access>(this.url(`/${id}/access`), { restricted, elements });
  }
}
