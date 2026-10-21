import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService, toInstant } from '../core/api.config';
import { Consigne, SalleTempAttr, Temperature } from '../models/models';

/**
 * Client Angular de SalleTempAttrResource — /api/salletemps.
 * Données d'une salle seule (sans ses boîtiers ni les consignes héritées) : les pages passent par
 * ClimatService, qui agrège la hiérarchie comme l'interface JSF.
 */
@Injectable({ providedIn: 'root' })
export class SalleTempAttrService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private get url(): string {
    return this.serveur.url('/salletemps');
  }

  // ---------- CRUD ----------

  getAll(): Observable<SalleTempAttr[]> {
    return this.http.get<SalleTempAttr[]>(this.url);
  }

  getById(id: number): Observable<SalleTempAttr | null> {
    return this.http.get<SalleTempAttr | null>(`${this.url}/${id}`);
  }

  /** ADMIN, GESTIONNAIRE — 201 si créé, 409 si déjà existant. */
  add(attr: SalleTempAttr): Observable<void> {
    return this.http.post<void>(this.url, attr);
  }

  /** ADMIN, GESTIONNAIRE */
  update(id: number, attr: SalleTempAttr): Observable<void> {
    return this.http.put<void>(`${this.url}/${id}`, attr);
  }

  /** ADMIN */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  // ---------- Recherches ----------

  getBySalleId(salleId: number): Observable<SalleTempAttr[] | null> {
    return this.http.get<SalleTempAttr[] | null>(`${this.url}/room/${salleId}`);
  }

  getByTemperatureId(temperatureId: number): Observable<SalleTempAttr | null> {
    return this.http.get<SalleTempAttr | null>(`${this.url}/temperature/${temperatureId}`);
  }

  // ---------- Données d'une salle ----------

  getCurrentTemperatures(salleId: number): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${salleId}/current`);
  }

  getConsigne(salleId: number): Observable<Consigne | null> {
    return this.http.get<Consigne | null>(`${this.url}/room/${salleId}/consigne`);
  }

  getLatestMeasured(salleId: number): Observable<Temperature | null> {
    return this.http.get<Temperature | null>(`${this.url}/room/${salleId}/measured/latest`);
  }

  getTemperaturesTimed(salleId: number, start: Date | string, end: Date | string): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${salleId}/temperatures`, {
      params: this.range(start, end),
    });
  }

  getConsignesTimed(salleId: number, start: Date | string, end: Date | string): Observable<Consigne[] | null> {
    return this.http.get<Consigne[] | null>(`${this.url}/room/${salleId}/consignes`, {
      params: this.range(start, end),
    });
  }

  getAverageTemperatureTimed(salleId: number, start: Date | string, end: Date | string): Observable<Temperature[] | null> {
    return this.http.get<Temperature[] | null>(`${this.url}/room/${salleId}/average`, {
      params: this.range(start, end),
    });
  }

  /** Envoie une nouvelle consigne à la salle (PUT /room/{id}/consigne?value=...). 404 si salle inconnue. */
  sendConsigne(salleId: number, value: number): Observable<void> {
    return this.http.put<void>(`${this.url}/room/${salleId}/consigne`, null, {
      params: new HttpParams().set('value', value),
    });
  }

  private range(start: Date | string, end: Date | string): HttpParams {
    return new HttpParams().set('start', toInstant(start)).set('end', toInstant(end));
  }
}
