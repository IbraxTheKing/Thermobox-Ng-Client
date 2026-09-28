import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../core/api.config';
import { User } from '../models/models';

/** Client Angular de UserResource — /api/users */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/users`;

  /** ADMIN */
  getAll(): Observable<User[]> {
    return this.http.get<User[]>(this.url);
  }

  getById(id: number): Observable<User | null> {
    return this.http.get<User | null>(`${this.url}/${id}`);
  }

  getByUsername(username: string): Observable<User | null> {
    return this.http.get<User | null>(`${this.url}/username/${encodeURIComponent(username)}`);
  }

  /** Inscription — 201 si créé, 409 si déjà existant. */
  add(user: User): Observable<void> {
    return this.http.post<void>(this.url, user);
  }

  /** ADMIN ou propriétaire du compte */
  update(id: number, user: User): Observable<void> {
    return this.http.put<void>(`${this.url}/${id}`, user);
  }

  /** ADMIN ou propriétaire du compte */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
