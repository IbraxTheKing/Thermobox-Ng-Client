import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService, toInstant } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { SetpointSending, History, Point } from '../models/models';

/**
 * Angular client of the climate resource — /api/v2/climate: the temperatures at any level (a
 * room, a floor or a building aggregates its devices) and the sending of setpoints.
 */
@Injectable({ providedIn: 'root' })
export class ClimateService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path: string): string {
    return this.server.url(`/climat${path}`);
  }

  history(id: number, start: Date, end: Date): Observable<History> {
    return this.http.get<History>(this.url(`/${id}/historique`), {
      params: { start: toInstant(start), end: toInstant(end) },
    });
  }

  /** Average curve of several elements: { "3": [points], … }. */
  averages(ids: number[], start: Date, end: Date, quiet = false): Observable<Record<string, Point[]>> {
    return this.http.get<Record<string, Point[]>>(this.url('/moyennes'), {
      params: { ids: ids.join(','), start: toInstant(start), end: toInstant(end) },
      context: new HttpContext().set(DISCRETE, quiet),
    });
  }

  /**
   * ADMIN, MANAGER — setpoint (Celsius) of a building, a floor or a room, sent to its devices;
   * what has its own setpoint keeps it, unless [force].
   */
  sendSetpoint(id: number, value: number, force = false): Observable<SetpointSending> {
    return this.http.put<SetpointSending>(this.url(`/${id}/consigne`), { value, force: force });
  }
}
