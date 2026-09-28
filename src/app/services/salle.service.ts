import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../core/api.config';
import { Salle } from '../models/models';

/** Client Angular de SalleResource — /api/salles */
@Injectable({ providedIn: 'root' })
export class SalleService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/salles`;

  getAll(): Observable<Salle[]> {
    return this.http.get<Salle[]>(this.url);
  }

  getById(id: number): Observable<Salle | null> {
    return this.http.get<Salle | null>(`${this.url}/${id}`);
  }

  getByName(name: string): Observable<Salle | null> {
    return this.http.get<Salle | null>(`${this.url}/name/${encodeURIComponent(name)}`);
  }

  /** ADMIN — 201 si créé, 409 si déjà existant. */
  add(salle: Salle): Observable<void> {
    return this.http.post<void>(this.url, salle);
  }

  /** ADMIN */
  update(id: number, salle: Salle): Observable<void> {
    return this.http.put<void>(`${this.url}/${id}`, salle);
  }

  /** ADMIN */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
