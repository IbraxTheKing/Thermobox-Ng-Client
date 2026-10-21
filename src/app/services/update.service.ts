import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { EtatMisesAJour, Installation, Preparation } from '../models/models';

/** Client Angular de UpdateResource — /api/updates : versions du serveur REST. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin = ''): string {
    return this.serveur.url(`/updates${chemin}`);
  }

  /** Tout utilisateur connecté : version installée, versions disponibles. */
  etat(discret = false): Observable<EtatMisesAJour> {
    return this.http.get<EtatMisesAJour>(this.url(), { context: new HttpContext().set(DISCRETE, discret) });
  }

  /** ADMIN — vérifie sur GitHub maintenant. */
  verifier(): Observable<EtatMisesAJour> {
    return this.http.post<EtatMisesAJour>(this.url('/check'), null);
  }

  /** ADMIN — déroulement de la dernière installation (null : aucune). */
  installation(): Observable<Installation | null> {
    return this.http.get<Installation | null>(this.url('/installation'), { context: new HttpContext().set(DISCRETE, true) });
  }

  /** ADMIN — contrôles, risques et sauvegarde avant d'installer [version]. */
  preparer(version: string): Observable<Preparation> {
    return this.http.get<Preparation>(this.url(`/${encodeURIComponent(version)}`));
  }

  /** ADMIN — lance l'installation ; le serveur redémarre ensuite sur la nouvelle version. */
  installer(version: string, backupDatabase: boolean, acceptRisks: boolean): Observable<Installation> {
    return this.http.post<Installation>(this.url(`/${encodeURIComponent(version)}/install`), { backupDatabase, acceptRisks });
  }
}
