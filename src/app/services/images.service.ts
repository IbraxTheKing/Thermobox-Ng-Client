import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SalleService } from './salle.service';

/**
 * Photos of the salles. An <img src> can't send the JWT, so each photo is fetched with it and shown
 * from a blob: URL, kept for the session per (element, version): a new photo has a new version.
 */
@Injectable({ providedIn: 'root' })
export class ImagesService {
  private readonly salles = inject(SalleService);
  private readonly cache = new Map<string, Promise<string | null>>();

  url(id: number, version: number): Promise<string | null> {
    const cle = `${id}:${version}`;
    let p = this.cache.get(cle);
    if (!p) {
      p = firstValueFrom(this.salles.getImage(id, version))
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => {
          this.cache.delete(cle);
          return null;
        });
      this.cache.set(cle, p);
    }
    return p;
  }

  /** Forgets the photos of [id] (replaced or removed). */
  oublier(id: number): void {
    for (const [cle, p] of this.cache) {
      if (cle.startsWith(`${id}:`)) {
        void p.then((u) => u && URL.revokeObjectURL(u));
        this.cache.delete(cle);
      }
    }
  }
}
