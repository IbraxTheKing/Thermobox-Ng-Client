import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { RoomService } from './room.service';

/**
 * Photos of the rooms. An <img src> can't send the JWT, so each photo is fetched with it and shown
 * from a blob: URL, kept for the session per (element, version): a new photo has a new version.
 */
@Injectable({ providedIn: 'root' })
export class ImagesService {
  private readonly rooms = inject(RoomService);
  private readonly cache = new Map<string, Promise<string | null>>();

  url(id: number, version: number): Promise<string | null> {
    const key = `${id}:${version}`;
    let p = this.cache.get(key);
    if (!p) {
      p = firstValueFrom(this.rooms.getImage(id, version))
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => {
          this.cache.delete(key);
          return null;
        });
      this.cache.set(key, p);
    }
    return p;
  }

  /** Forgets the photos of [id] (replaced or removed). */
  forget(id: number): void {
    for (const [key, p] of this.cache) {
      if (key.startsWith(`${id}:`)) {
        void p.then((u) => u && URL.revokeObjectURL(u));
        this.cache.delete(key);
      }
    }
  }
}
