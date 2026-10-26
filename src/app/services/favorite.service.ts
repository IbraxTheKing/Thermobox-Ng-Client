import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService } from '../core/api.config';

/** Angular client of the favorites resource — /api/v2/favorites: the rooms pinned on the dashboard. */
@Injectable({ providedIn: 'root' })
export class FavoriteService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);

  list(): Observable<number[]> {
    return this.http.get<number[]>(this.server.url('/favoris'));
  }

  add(roomId: number): Observable<void> {
    return this.http.put<void>(this.server.url(`/favoris/${roomId}`), null);
  }

  remove(roomId: number): Observable<void> {
    return this.http.delete<void>(this.server.url(`/favoris/${roomId}`));
  }
}
