import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { Acces, User, UserChanges } from '../models/models';

/** Client Angular de UserResource — /api/users */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin = ''): string {
    return this.serveur.url(`/users${chemin}`);
  }

  /** ADMIN */
  getAll(): Observable<User[]> {
    return this.http.get<User[]>(this.url());
  }

  /** ADMIN ou propriétaire du compte */
  getById(id: number): Observable<User | null> {
    return this.http.get<User | null>(this.url(`/${id}`));
  }

  /** ADMIN */
  getByUsername(username: string): Observable<User | null> {
    return this.http.get<User | null>(this.url(`/username/${encodeURIComponent(username)}`));
  }

  /**
   * Inscription publique (toujours VIEWER) — 201 si créé, 409 si le nom est pris. [base] : un autre
   * serveur que celui de l'application (page d'inscription).
   */
  add(user: { username: string; password: string }, base?: string): Observable<void> {
    return this.http.post<void>(base ? `${base}/users` : this.url(), user);
  }

  /** ADMIN ou propriétaire : seuls les champs renseignés changent ; le rôle, ADMIN seulement. */
  update(id: number, changes: UserChanges): Observable<User> {
    return this.http.put<User>(this.url(`/${id}`), changes);
  }

  /** ADMIN ou propriétaire du compte */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  /** ADMIN ou propriétaire : tout, ou seulement certains bâtiments / étages / salles. */
  getAcces(id: number): Observable<Acces> {
    return this.http.get<Acces>(this.url(`/${id}/acces`));
  }

  /** ADMIN — un compte ADMIN ne peut pas être limité. */
  setAcces(id: number, restricted: boolean, elements: number[]): Observable<Acces> {
    return this.http.put<Acces>(this.url(`/${id}/acces`), { restricted, elements });
  }
}
