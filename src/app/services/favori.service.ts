import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService } from '../core/api.config';

/** Client Angular de FavoriResource — /api/favoris : les salles épinglées sur l'aperçu. */
@Injectable({ providedIn: 'root' })
export class FavoriService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);

  lister(): Observable<number[]> {
    return this.http.get<number[]>(this.serveur.url('/favoris'));
  }

  ajouter(salleId: number): Observable<void> {
    return this.http.put<void>(this.serveur.url(`/favoris/${salleId}`), null);
  }

  retirer(salleId: number): Observable<void> {
    return this.http.delete<void>(this.serveur.url(`/favoris/${salleId}`));
  }
}
