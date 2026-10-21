import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { Temperature, TemperatureType } from '../models/models';

/** Une température avec son type, que le JSON de /api/temperatures ne donne pas. */
export interface TemperatureTypee extends Temperature {
  type: TemperatureType;
}

/** Client Angular de TemperatureResource — /api/temperatures */
@Injectable({ providedIn: 'root' })
export class TemperatureService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin = ''): string {
    return this.serveur.url(`/temperatures${chemin}`);
  }

  getAll(): Observable<Temperature[]> {
    return this.http.get<Temperature[]>(this.url());
  }

  getById(id: number): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(this.url(`/${id}`));
  }

  /** type : 'consigne' | 'mesurer' */
  getByType(type: TemperatureType): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(this.url(`/type/${type}`));
  }

  /** Les mesures et/ou les consignes, chacune avec son type (« Toutes » : les deux listes). */
  getTypees(filtre: TemperatureType | 'tous'): Observable<TemperatureTypee[]> {
    const types: TemperatureType[] = filtre === 'tous' ? ['mesurer', 'consigne'] : [filtre];
    return forkJoin(
      types.map((type) => this.getByType(type).pipe(map((l) => (l ?? []).map((t) => ({ ...t, type }))))),
    ).pipe(map((listes) => listes.flat()));
  }

  /** type : 'consigne' | 'mesurer' */
  getAverage(type: TemperatureType): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(this.url(`/average/${type}`));
  }

  /** ADMIN — 201 si créé, 409 si déjà existant. */
  add(temperature: Temperature): Observable<void> {
    return this.http.post<void>(this.url(), temperature);
  }

  /** ADMIN — ajoute une mesure ou une consigne (date : LocalDateTime « 2026-10-21T14:05:00 »). */
  addTyped(type: TemperatureType, value: number, date: string): Observable<void> {
    return this.http.post<void>(this.url(`/type/${type}`), { value, date });
  }

  /** ADMIN */
  update(id: number, temperature: Temperature): Observable<void> {
    return this.http.put<void>(this.url(`/${id}`), temperature);
  }

  /** ADMIN */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }
}
