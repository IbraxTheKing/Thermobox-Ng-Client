import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { ServerService } from '../core/api.config';
import { Temperature, TemperatureType } from '../models/models';

/** A temperature with its type, which the JSON of /api/temperatures does not give. */
export interface TemperatureTyped extends Temperature {
  type: TemperatureType;
}

/** Client Angular de TemperatureResource — /api/temperatures */
@Injectable({ providedIn: 'root' })
export class TemperatureService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path = ''): string {
    return this.server.url(`/temperatures${path}`);
  }

  getAll(): Observable<Temperature[]> {
    return this.http.get<Temperature[]>(this.url());
  }

  getById(id: number): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(this.url(`/${id}`));
  }

  /** type : 'setpoint' | 'measurement' */
  getByType(type: TemperatureType): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(this.url(`/type/${type}`));
  }

  /** The measurements and/or the setpoints, each with its type ("all": both lists). */
  getTyped(filter: TemperatureType | 'all'): Observable<TemperatureTyped[]> {
    const types: TemperatureType[] = filter === 'all' ? ['measurement', 'setpoint'] : [filter];
    return forkJoin(
      types.map((type) => this.getByType(type).pipe(map((l) => (l ?? []).map((t) => ({ ...t, type }))))),
    ).pipe(map((lists) => lists.flat()));
  }

  /** type : 'setpoint' | 'measurement' */
  getAverage(type: TemperatureType): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(this.url(`/average/${type}`));
  }

  /** ADMIN — 201 when created, 409 when it already exists. */
  add(temperature: Temperature): Observable<void> {
    return this.http.post<void>(this.url(), temperature);
  }

  /** ADMIN — adds a measurement or a setpoint (date: LocalDateTime "2026-10-21T14:05:00"). */
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
