import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { EtatMisesAJour } from '../models/models';
import { UpdateService } from '../services/update.service';
import { AuthService } from './auth';

/** The rail badge and the banner shown to admins when a version is out (UpdateNoticeBean). */
@Injectable({ providedIn: 'root' })
export class AvisMajService {
  private readonly api = inject(UpdateService);
  private readonly auth = inject(AuthService);
  readonly etat = signal<EtatMisesAJour | null>(null);
  private derniere = 0;

  readonly disponible = computed(() => this.auth.admin() && this.etat()?.updateAvailable === true);

  /** « 26.11.0 (fonctionnelle) et 26.10.2 (corrective, recommandée) » */
  readonly resume = computed(() => {
    const e = this.etat();
    if (!e) return '';
    return [e.latestPatch, e.latestFeature]
      .filter((v) => v != null)
      .map((v) => `${v!.version} (${v!.typeLabel.toLowerCase()}${v!.type === 'CORRECTIVE' ? ', recommandée' : ''})`)
      .join(' et ');
  });

  /** At most once an hour: the server itself checks GitHub once a day. */
  async verifier(force = false): Promise<void> {
    if (!this.auth.admin()) return;
    if (!force && Date.now() - this.derniere < 3_600_000) return;
    this.derniere = Date.now();
    try {
      this.etat.set(await firstValueFrom(this.api.etat(true)));
    } catch {
      /* not essential */
    }
  }
}
