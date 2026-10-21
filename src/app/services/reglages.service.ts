import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { PreferencesService } from '../core/preferences';
import { Reglages, StyleSite } from '../models/models';

/** Client Angular de ReglagesResource — /api/reglages : l'apparence choisie par un ADMIN pour tous. */
@Injectable({ providedIn: 'root' })
export class ReglagesService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private readonly prefs = inject(PreferencesService);

  /** Lit le style et l'applique à cette page. */
  charger(): Observable<Reglages> {
    return this.http.get<Reglages>(this.serveur.url('/reglages')).pipe(tap((r) => this.prefs.style.set(r.style)));
  }

  /** ADMIN — pour tous les utilisateurs, sur tous les appareils. */
  changerStyle(style: StyleSite): Observable<Reglages> {
    return this.http.put<Reglages>(this.serveur.url('/reglages'), { style }).pipe(tap((r) => this.prefs.style.set(r.style)));
  }
}
