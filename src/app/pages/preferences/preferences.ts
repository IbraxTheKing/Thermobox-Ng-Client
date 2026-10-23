import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ClavierService } from '../../core/clavier';
import { ToastService } from '../../core/messages';
import { PlateformeService } from '../../core/plateforme';
import { PreferencesService } from '../../core/preferences';
import { ReglagesService } from '../../services/reglages.service';
import { TbSwitch } from '../../ui/controles';

/**
 * Préférences (preferences.xhtml): animations, colours following the state, unit, keyboard
 * shortcuts (kept on this device) and, for an ADMIN, the look of every client.
 */
@Component({
  selector: 'tb-preferences',
  imports: [TbSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences.html',
})
export class PreferencesPage {
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly clavier = inject(ClavierService);
  protected readonly plateforme = inject(PlateformeService);
  private readonly reglages = inject(ReglagesService);
  private readonly toasts = inject(ToastService);

  protected readonly panneau = computed(() => this.prefs.style() === 'panneau');
  protected readonly enregistrementStyle = signal(false);
  /** Phones and tablets: no keyboard, no list. */
  protected readonly avecClavier = matchMedia('(hover: hover) and (pointer: fine)').matches;
  protected readonly nomPlateforme = { ios: 'iOS (Liquid Glass)', android: 'Android (Material 3)', web: 'Web (ThermoBox)' }[this.plateforme.plateforme];

  /** Saves the control-panel look for every user. */
  protected async changerStyle(panneau: boolean): Promise<void> {
    this.enregistrementStyle.set(true);
    try {
      await firstValueFrom(this.reglages.changerStyle(panneau ? 'panneau' : 'verre'));
      this.toasts.info(panneau ? 'Style panneau de configuration pour tout le monde' : "Style d'origine pour tout le monde");
    } catch (e) {
      this.toasts.error('Réglage non enregistré', messageErreur(e));
    } finally {
      this.enregistrementStyle.set(false);
    }
  }
}
