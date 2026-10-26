import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ServerService } from '../core/api.config';
import { Room } from '../models/models';

/**
 * Angular client of the rooms resource — /api/v2/rooms.
 * The elements come without their kind (building, floor…): HierarchyService gives it.
 */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path = ''): string {
    return this.server.url(`/rooms${path}`);
  }

  getAll(): Observable<Room[]> {
    return this.http.get<Room[]>(this.url());
  }

  getById(id: number): Observable<Room | null> {
    return this.http.get<Room | null>(this.url(`/${id}`));
  }

  getByName(name: string): Observable<Room | null> {
    return this.http.get<Room | null>(this.url(`/name/${encodeURIComponent(name)}`));
  }

  /** ADMIN — 201 when created, 409 when it already exists. */
  add(room: Room): Observable<void> {
    return this.http.post<void>(this.url(), room);
  }

  /** ADMIN */
  update(id: number, room: Room): Observable<void> {
    return this.http.put<void>(this.url(`/${id}`), room);
  }

  /**
   * ADMIN — deletes the element with its history, its photo and its favorites; what it contains is
   * kept but no longer attached.
   */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  // ---------- Photo ----------

  /** The photo (JPEG), shown with URL.createObjectURL: an <img> does not send the token. */
  getImage(id: number, version: number | null): Observable<Blob> {
    return this.http.get(this.url(`/${id}/image`), { params: version != null ? { v: version } : {}, responseType: 'blob' });
  }

  /** ADMIN — replaces the photo (JPEG, PNG, GIF or BMP, 10 MB max); returns its new version. */
  putImage(id: number, file: Blob): Observable<number | null> {
    return this.http
      .put<{ image: number | null }>(this.url(`/${id}/image`), file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      .pipe(map((r) => r.image));
  }

  /** ADMIN */
  deleteImage(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}/image`));
  }
}
