import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService, toInstant } from '../core/api.config';
import { Setpoint, RoomTempAttr, Temperature } from '../models/models';

/**
 * Angular client of the room temps resource — /api/v2/roomtemps.
 * Data of a single room (without its devices nor the inherited setpoints): the pages go through
 * ClimateService, which aggregates the hierarchy.
 */
@Injectable({ providedIn: 'root' })
export class RoomTempAttrService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private get url(): string {
    return this.server.url('/roomtemps');
  }

  // ---------- CRUD ----------

  getAll(): Observable<RoomTempAttr[]> {
    return this.http.get<RoomTempAttr[]>(this.url);
  }

  getById(id: number): Observable<RoomTempAttr | null> {
    return this.http.get<RoomTempAttr | null>(`${this.url}/${id}`);
  }

  /** ADMIN, MANAGER — 201 when created, 409 when it already exists. */
  add(attr: RoomTempAttr): Observable<void> {
    return this.http.post<void>(this.url, attr);
  }

  /** ADMIN, MANAGER */
  update(id: number, attr: RoomTempAttr): Observable<void> {
    return this.http.put<void>(`${this.url}/${id}`, attr);
  }

  /** ADMIN */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  // ---------- Recherches ----------

  getByRoomId(roomId: number): Observable<RoomTempAttr[] | null> {
    return this.http.get<RoomTempAttr[] | null>(`${this.url}/room/${roomId}`);
  }

  getByTemperatureId(temperatureId: number): Observable<RoomTempAttr | null> {
    return this.http.get<RoomTempAttr | null>(`${this.url}/temperature/${temperatureId}`);
  }

  // ---------- Data of a room ----------

  getCurrentTemperatures(roomId: number): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${roomId}/current`);
  }

  getSetpoint(roomId: number): Observable<Setpoint | null> {
    return this.http.get<Setpoint | null>(`${this.url}/room/${roomId}/setpoint`);
  }

  getLatestMeasured(roomId: number): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(`${this.url}/room/${roomId}/measured/latest`);
  }

  getTemperaturesTimed(roomId: number, start: Date | string, end: Date | string): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${roomId}/temperatures`, {
      params: this.range(start, end),
    });
  }

  getSetpointsTimed(roomId: number, start: Date | string, end: Date | string): Observable<Setpoint[] | null> {
    return this.http.get<Setpoint[] | null>(`${this.url}/room/${roomId}/setpoints`, {
      params: this.range(start, end),
    });
  }

  getAverageTemperatureTimed(roomId: number, start: Date | string, end: Date | string): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${roomId}/average`, {
      params: this.range(start, end),
    });
  }

  /** Sends a new setpoint to the room (PUT /room/{id}/setpoint?value=...). 404 for an unknown room. */
  sendSetpoint(roomId: number, value: number): Observable<void> {
    return this.http.put<void>(`${this.url}/room/${roomId}/setpoint`, null, {
      params: new HttpParams().set('value', value),
    });
  }

  private range(start: Date | string, end: Date | string): HttpParams {
    return new HttpParams().set('start', toInstant(start)).set('end', toInstant(end));
  }
}
