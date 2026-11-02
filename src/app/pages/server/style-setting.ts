import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { ToastService } from '../../core/messages';
import { PreferencesService } from '../../core/preferences';
import { SettingsService } from '../../services/settings.service';
import { TbSwitch } from '../../ui/controls';

/**
 * The look of every user, chosen by an ADMIN: « Maison », or the control-panel style. In the
 * Préférences page and in the settings of the Serveur page.
 */
@Component({
  selector: 'tb-style-setting',
  imports: [TbSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tb-panel tb-pref-admin">
      <div class="tb-prefs">
        <div class="tb-pref">
          <span class="tb-section-icon"><i class="pi pi-th-large"></i></span>
          <div class="tb-pref-text">
            <strong i18n>Style panneau de configuration</strong>
            <span i18n class="tb-muted">
              Pour tous les utilisateurs : surfaces unies, sans effet de verre, de flou ni de fond coloré, coins plus droits. Le thème clair
              ou sombre et l'accent de couleur de chacun sont conservés.
            </span>
          </div>
          <tb-switch [checked]="panel()" [disabled]="saving()" (checkedChange)="change($event)" i18n-label label="Style panneau de configuration" />
        </div>
      </div>
      <p i18n class="tb-muted tb-pref-scope"><i class="pi pi-shield"></i> Réglage administrateur : s'applique à tout le monde, sur tous les appareils.</p>
    </section>
  `,
})
export class TbStyleSetting {
  private readonly prefs = inject(PreferencesService);
  private readonly settings = inject(SettingsService);
  private readonly toasts = inject(ToastService);

  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  protected readonly saving = signal(false);

  /** Saves the control-panel look for every user. */
  protected async change(panel: boolean): Promise<void> {
    this.saving.set(true);
    try {
      await firstValueFrom(this.settings.changeStyle(panel ? 'panel' : 'glass'));
      this.toasts.info(panel ? $localize`Style panneau de configuration pour tout le monde` : $localize`Style d'origine pour tout le monde`);
    } catch (e) {
      this.toasts.error('Réglage non enregistré', errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
