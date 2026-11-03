import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TbSwitch } from '../../app/ui/controls';
import { WindowsSettings } from './settings';

/**
 * Préférences › Apparence, the Windows app: the Acrylic of the window and the blur of the bars.
 * A row of the list itself (its element is the div.tb-pref: the rules of the list apply).
 */
@Component({
  selector: 'div.tb-pref.tb-pref-blur',
  imports: [TbSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tb-section-icon"><i class="pi pi-clone"></i></span>
    <div class="tb-pref-text">
      <strong i18n>Effets de transparence</strong>
      <span i18n class="tb-muted">Le flou de Windows (Acrylic) derrière la barre de navigation et la barre de titre, et le flou de ce qui passe sous les barres. Désactivés, tout est opaque : un peu moins de travail pour la carte graphique.</span>
    </div>
    <tb-switch [checked]="settings.blur()" (checkedChange)="settings.blur.set($event)" i18n-label label="Effets de transparence" />
  `,
})
export class TbWindowsPreferences {
  protected readonly settings = inject(WindowsSettings);
}
