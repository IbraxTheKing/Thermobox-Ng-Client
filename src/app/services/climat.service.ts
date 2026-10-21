import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService, toInstant } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { EnvoiConsigne, Historique, Point } from '../models/models';

/**
 * Client Angular de ClimatResource — /api/climat : les températures à n'importe quel niveau
 * (une salle, un étage ou un bâtiment agrège ses boîtiers) et l'envoi des consignes.
 */
@Injectable({ providedIn: 'root' })
export class ClimatService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin: string): string {
    return this.serveur.url(`/climat${chemin}`);
  }

  historique(id: number, debut: Date, fin: Date): Observable<Historique> {
    return this.http.get<Historique>(this.url(`/${id}/historique`), {
      params: { start: toInstant(debut), end: toInstant(fin) },
    });
  }

  /** Courbe moyenne de plusieurs éléments : { "3": [points], … }. */
  moyennes(ids: number[], debut: Date, fin: Date, discret = false): Observable<Record<string, Point[]>> {
    return this.http.get<Record<string, Point[]>>(this.url('/moyennes'), {
      params: { ids: ids.join(','), start: toInstant(debut), end: toInstant(fin) },
      context: new HttpContext().set(DISCRETE, discret),
    });
  }

  /**
   * ADMIN, GESTIONNAIRE — consigne (Celsius) d'un bâtiment, d'un étage ou d'une salle, envoyée à
   * ses boîtiers ; ce qui a sa propre consigne la garde, sauf [forcer].
   */
  envoyerConsigne(id: number, value: number, forcer = false): Observable<EnvoiConsigne> {
    return this.http.put<EnvoiConsigne>(this.url(`/${id}/consigne`), { value, force: forcer });
  }
}
