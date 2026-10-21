import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { Arbre, DetailElement, ElementRequest, Noeud } from '../models/models';

/**
 * Client Angular de HierarchieResource — /api/hierarchie : bâtiments → étages → salles → boîtiers,
 * tels que l'utilisateur connecté peut les voir, avec températures, consignes, photos, favoris.
 */
@Injectable({ providedIn: 'root' })
export class HierarchieService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin: string): string {
    return this.serveur.url(`/hierarchie${chemin}`);
  }

  /** [discret] : rafraîchissement automatique, sans barre d'activité. */
  arbre(discret = false): Observable<Arbre> {
    return this.http.get<Arbre>(this.url('/arbre'), { context: new HttpContext().set(DISCRETE, discret) });
  }

  detail(id: number, discret = false): Observable<DetailElement> {
    return this.http.get<DetailElement>(this.url(`/elements/${id}`), { context: new HttpContext().set(DISCRETE, discret) });
  }

  /** ADMIN */
  creer(demande: ElementRequest): Observable<Noeud> {
    return this.http.post<Noeud>(this.url('/elements'), demande);
  }

  /** ADMIN — renomme et déplace (parentId null : détache). */
  modifier(id: number, name: string, parentId: number | null): Observable<Noeud> {
    return this.http.put<Noeud>(this.url(`/elements/${id}`), { name, parentId });
  }

  /** ADMIN — déplace seulement (null : détache). */
  deplacer(id: number, parentId: number | null): Observable<Noeud> {
    return this.http.put<Noeud>(this.url(`/elements/${id}/parent`), { parentId });
  }
}
