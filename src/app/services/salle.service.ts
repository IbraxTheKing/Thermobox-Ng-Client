import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { Salle } from '../models/models';

/**
 * Client Angular de SalleResource — /api/salles.
 * Les éléments y sont sans leur type (bâtiment, étage…) : HierarchieService les donne avec.
 */
@Injectable({ providedIn: 'root' })
export class SalleService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin = ''): string {
    return this.serveur.url(`/salles${chemin}`);
  }

  getAll(): Observable<Salle[]> {
    return this.http.get<Salle[]>(this.url());
  }

  getById(id: number): Observable<Salle | null> {
    return this.http.get<Salle | null>(this.url(`/${id}`));
  }

  getByName(name: string): Observable<Salle | null> {
    return this.http.get<Salle | null>(this.url(`/name/${encodeURIComponent(name)}`));
  }

  /** ADMIN — 201 si créé, 409 si déjà existant. */
  add(salle: Salle): Observable<void> {
    return this.http.post<void>(this.url(), salle);
  }

  /** ADMIN */
  update(id: number, salle: Salle): Observable<void> {
    return this.http.put<void>(this.url(`/${id}`), salle);
  }

  /**
   * ADMIN — supprime l'élément avec son historique, sa photo et ses favoris ; ce qu'il contient est
   * gardé mais n'est plus rattaché.
   */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  // ---------- Photo ----------

  /** La photo (JPEG), à afficher avec URL.createObjectURL : une <img> n'envoie pas le jeton. */
  getImage(id: number, version: number | null): Observable<Blob> {
    return this.http.get(this.url(`/${id}/image`), { params: version != null ? { v: version } : {}, responseType: 'blob' });
  }

  /** ADMIN — remplace la photo (JPEG, PNG, GIF ou BMP, 10 Mo max) ; renvoie sa nouvelle version. */
  putImage(id: number, fichier: Blob): Observable<number | null> {
    return this.http
      .put<{ image: number | null }>(this.url(`/${id}/image`), fichier, {
        headers: { 'Content-Type': fichier.type || 'application/octet-stream' },
      })
      .pipe(map((r) => r.image));
  }

  /** ADMIN */
  deleteImage(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}/image`));
  }
}
