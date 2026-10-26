import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { ServerService } from '../core/api.config';
import { Temperature, TemperatureType } from '../models/models';

/** A temperature with its type, which the JSON of /api/v2/temperatures does not give. */
export interface TemperatureTyped extends Temperature {
  type: TemperatureType;
}

/** Angular client of the temperatures resource — /api/v2/temperatures */
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

  /**
   * A page of the temperatures of [type], the latest first (26.12: ?limit=&offset=, the total in
   * X-Total-Count with the first page, for a user who sees everything). A server before 26.12
   * answers every temperature at once: [all] then says so.
   */
  page(type: TemperatureType, offset: number, limit: number): Observable<{ items: Temperature[]; total: number | null; all: boolean }> {
    return this.http
      .get<Temperature[] | null>(this.url(`/type/${type}`), { params: { limit, offset }, observe: 'response' })
      .pipe(
        map((r) => {
          const items = r.body ?? [];
          const total = r.headers.get('X-Total-Count');
          return { items, total: total != null && total !== '' ? Number(total) : null, all: items.length > limit };
        }),
      );
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
