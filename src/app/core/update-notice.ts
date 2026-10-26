import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { UpdatesState } from '../models/models';
import { UpdateService } from '../services/update.service';
import { AuthService } from './auth';

/** The rail badge and the banner shown to admins when a version is out (UpdateNoticeBean). */
@Injectable({ providedIn: 'root' })
export class UpdateNoticeService {
  private readonly api = inject(UpdateService);
  private readonly auth = inject(AuthService);
  readonly state = signal<UpdatesState | null>(null);
  private last = 0;

  readonly available = computed(() => this.auth.admin() && this.state()?.updateAvailable === true);

  /** « 26.11.0 (fonctionnelle) et 26.10.2 (corrective, recommandée) » */
  readonly summary = computed(() => {
    const e = this.state();
    if (!e) return '';
    return [e.latestPatch, e.latestFeature]
      .filter((v) => v != null)
      .map((v) => `${v!.version} (${v!.typeLabel.toLowerCase()}${v!.type === 'PATCH' ? ', recommandée' : ''})`)
      .join(' et ');
  });

  /** At most once an hour: the server itself checks GitHub once a day. */
  async check(force = false): Promise<void> {
    if (!this.auth.admin()) return;
    if (!force && Date.now() - this.last < 3_600_000) return;
    this.last = Date.now();
    try {
      this.state.set(await firstValueFrom(this.api.state(true)));
    } catch {
      /* not essential */
    }
  }
}
