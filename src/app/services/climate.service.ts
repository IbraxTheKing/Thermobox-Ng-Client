import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { ServerService, toInstant } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { SetpointSending, History, Point } from '../models/models';

/**
 * Angular client of the climate resource — /api/v2/climate: the temperatures at any level (a
 * room, a floor or a building aggregates its devices) and the sending of setpoints.
 */
/** Points per curve by default: as many as a chart of the room page can draw (forChart). */
export const HISTORY_POINTS = 400;
/** Points of a dashboard sparkline (48 slots, twice as many keeps each slot filled). */
export const SPARKLINE_POINTS = 96;
/** Elements per /averages request (server limit). */
export const MAX_IDS = 200;

@Injectable({ providedIn: 'root' })
export class ClimateService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path: string): string {
    return this.server.url(`/climate${path}`);
  }

  /**
   * Curves of an element over the period. [points]: at most that many points per measurement
   * curve, picked by the server among the real measures (26.12; an older server sends them all
   * and ignores it). A chart needs about as many points as it has slots: a month of a device is
   * 43 200 measures, but 400 points draw the same line.
   */
  history(id: number, start: Date, end: Date, points = HISTORY_POINTS): Observable<History> {
    return this.http.get<History>(this.url(`/${id}/history`), {
      params: { start: toInstant(start), end: toInstant(end), points },
    });
  }

  /**
   * Average curve of several elements: { "3": [points], … }, at most [points] points each (see
   * [history]). At most [MAX_IDS] elements per request: more are sent in several.
   */
  averages(ids: number[], start: Date, end: Date, quiet = false, points = HISTORY_POINTS): Observable<Record<string, Point[]>> {
    if (ids.length > MAX_IDS) {
      const batches: number[][] = [];
      for (let i = 0; i < ids.length; i += MAX_IDS) batches.push(ids.slice(i, i + MAX_IDS));
      return forkJoin(batches.map((b) => this.averages(b, start, end, quiet, points))).pipe(map((l) => Object.assign({}, ...l)));
    }
    return this.http.get<Record<string, Point[]>>(this.url('/averages'), {
      params: { ids: ids.join(','), start: toInstant(start), end: toInstant(end), points },
      context: new HttpContext().set(DISCRETE, quiet),
    });
  }

  /**
   * ADMIN, MANAGER — setpoint (Celsius) of a building, a floor or a room, sent to its devices;
   * what has its own setpoint keeps it, unless [force].
   */
  sendSetpoint(id: number, value: number, force = false): Observable<SetpointSending> {
    return this.http.put<SetpointSending>(this.url(`/${id}/setpoint`), { value, force });
  }
}
