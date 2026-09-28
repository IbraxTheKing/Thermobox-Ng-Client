import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../core/api.config';
import { Temperature, TemperatureType } from '../models/models';

/** Client Angular de TemperatureResource — /api/temperatures */
@Injectable({ providedIn: 'root' })
export class TemperatureService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/temperatures`;

  getAll(): Observable<Temperature[]> {
    return this.http.get<Temperature[]>(this.url);
  }

  getById(id: number): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(`${this.url}/${id}`);
  }

  /** type : 'consigne' | 'mesurer' */
  getByType(type: TemperatureType): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/type/${type}`);
  }

  /** type : 'consigne' | 'mesurer' */
  getAverage(type: TemperatureType): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(`${this.url}/average/${type}`);
  }

  /** ADMIN — 201 si créé, 409 si déjà existant. */
  add(temperature: Temperature): Observable<void> {
    return this.http.post<void>(this.url, temperature);
  }

  /** ADMIN */
  update(id: number, temperature: Temperature): Observable<void> {
    return this.http.put<void>(`${this.url}/${id}`, temperature);
  }

  /** ADMIN */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
