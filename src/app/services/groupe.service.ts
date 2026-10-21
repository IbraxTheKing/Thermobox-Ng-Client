import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServeurService } from '../core/api.config';
import { Groupe, GroupeRequest } from '../models/models';

/** Client Angular de GroupeResource — /api/groups (ADMIN). */
@Injectable({ providedIn: 'root' })
export class GroupeService {
  private readonly http = inject(HttpClient);
  private readonly serveur = inject(ServeurService);
  private url(chemin = ''): string {
    return this.serveur.url(`/groups${chemin}`);
  }

  lister(): Observable<Groupe[]> {
    return this.http.get<Groupe[]>(this.url());
  }

  lire(id: number): Observable<Groupe> {
    return this.http.get<Groupe>(this.url(`/${id}`));
  }

  creer(g: GroupeRequest): Observable<Groupe> {
    return this.http.post<Groupe>(this.url(), g);
  }

  /** Remplace le groupe : exactement ces membres et ces éléments. */
  modifier(id: number, g: GroupeRequest): Observable<Groupe> {
    return this.http.put<Groupe>(this.url(`/${id}`), g);
  }

  /** Ses membres gardent leurs propres accès. */
  supprimer(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  /** Corps d'enregistrement d'un groupe existant, à modifier. */
  static requete(g: Groupe): GroupeRequest {
    return { name: g.name, description: g.description, members: g.members.map((m) => m.id), elements: g.elements.map((e) => e.id) };
  }
}
