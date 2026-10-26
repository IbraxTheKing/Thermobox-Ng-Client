import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { Tree, DetailElement, ElementRequest, Node } from '../models/models';

/**
 * Angular client of the hierarchy resource — /api/v2/hierarchy: buildings → floors → rooms →
 * devices, as the logged-in user may see them, with temperatures, setpoints, photos, favorites.
 */
@Injectable({ providedIn: 'root' })
export class HierarchyService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path: string): string {
    return this.server.url(`/hierarchie${path}`);
  }

  /** [quiet]: automatic refresh, without the activity bar. */
  tree(quiet = false): Observable<Tree> {
    return this.http.get<Tree>(this.url('/arbre'), { context: new HttpContext().set(DISCRETE, quiet) });
  }

  detail(id: number, quiet = false): Observable<DetailElement> {
    return this.http.get<DetailElement>(this.url(`/elements/${id}`), { context: new HttpContext().set(DISCRETE, quiet) });
  }

  /** ADMIN */
  create(request: ElementRequest): Observable<Node> {
    return this.http.post<Node>(this.url('/elements'), request);
  }

  /** ADMIN — renames and moves (parentId null: detaches). */
  edit(id: number, name: string, parentId: number | null): Observable<Node> {
    return this.http.put<Node>(this.url(`/elements/${id}`), { name, parentId });
  }

  /** ADMIN — moves only (null: detaches). */
  move(id: number, parentId: number | null): Observable<Node> {
    return this.http.put<Node>(this.url(`/elements/${id}/parent`), { parentId });
  }
}
