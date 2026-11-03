import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { DesktopService } from '../../app/core/desktop';
import { TbSwitch } from '../../app/ui/controls';
import { LinuxDesktopService } from './desktop.service';
import { LinuxSettings } from './settings';

/**
 * Préférences › Fenêtre, the Linux app: the window (drawn by the page, or the system's), its
 * rendering (the graphics card or the processor), the swipe back of the touchpad. A group of the
 * page itself (its element is the section.tb-pref-group: the rules of the page apply).
 */
@Component({
  selector: 'section.tb-panel.tb-pref-group.tb-pref-linux',
  imports: [TbSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-labelledby': 'tb-pref-linux' },
  template: `
    @if (desktop.linuxOptions; as o) {
      <h2 i18n class="tb-pref-heading" id="tb-pref-linux">Fenêtre</h2>
      <div class="tb-prefs">
        <div class="tb-pref">
          <span class="tb-section-icon"><i class="pi pi-window-maximize"></i></span>
          <div class="tb-pref-text">
            <strong i18n>Style de la fenêtre</strong>
            <span i18n class="tb-muted">« GNOME » : dessinée par l'application, comme une application GNOME récente. « GTK 3 » : la fenêtre du système, avec sa barre de titre, ses boutons et son menu natifs.</span>
          </div>
          <div class="tb-segmented" role="radiogroup" i18n-aria-label aria-label="Style de la fenêtre">
            <button i18n type="button" role="radio" [attr.aria-checked]="linuxWindow() === 'gnome'" [class.tb-seg-on]="linuxWindow() === 'gnome'" (click)="linuxWindow.set('gnome')">GNOME</button>
            <button i18n type="button" role="radio" [attr.aria-checked]="linuxWindow() === 'gtk3'" [class.tb-seg-on]="linuxWindow() === 'gtk3'" (click)="linuxWindow.set('gtk3')">GTK 3</button>
          </div>
        </div>
        <div class="tb-pref">
          <span class="tb-section-icon"><i class="pi pi-bolt"></i></span>
          <div class="tb-pref-text">
            <strong i18n>Rendu</strong>
            <span i18n class="tb-muted">Sans carte graphique (machine virtuelle, WSL), le processeur dessine bien plus vite que la carte graphique qu'il imite. « Automatique » le choisit dans ce cas.</span>
            @if (o.software) {
              <span i18n class="tb-pref-note"><i class="pi pi-info-circle"></i> En ce moment : dessinée par le processeur.</span>
            } @else {
              <span i18n class="tb-pref-note"><i class="pi pi-info-circle"></i> En ce moment : dessinée par la carte graphique.</span>
            }
          </div>
          <div class="tb-segmented" role="radiogroup" i18n-aria-label aria-label="Rendu">
            <button i18n type="button" role="radio" [attr.aria-checked]="linuxRendering() === 'auto'" [class.tb-seg-on]="linuxRendering() === 'auto'" (click)="linuxRendering.set('auto')">Automatique</button>
            <button i18n type="button" role="radio" [attr.aria-checked]="linuxRendering() === 'gpu'" [class.tb-seg-on]="linuxRendering() === 'gpu'" (click)="linuxRendering.set('gpu')">Carte graphique</button>
            <button i18n type="button" role="radio" [attr.aria-checked]="linuxRendering() === 'cpu'" [class.tb-seg-on]="linuxRendering() === 'cpu'" (click)="linuxRendering.set('cpu')">Processeur</button>
          </div>
        </div>
        @if (linuxChanged()) {
          <div class="tb-pref tb-pref-restart" role="status">
            <span class="tb-section-icon"><i class="pi pi-refresh"></i></span>
            <div class="tb-pref-text">
              <strong i18n>Redémarrage nécessaire</strong>
              <span i18n class="tb-muted">La fenêtre et le rendu changent au démarrage de l'application.</span>
            </div>
            <button i18n type="button" class="tb-btn" (click)="restartLinux()">Redémarrer</button>
          </div>
        }
        <div class="tb-pref">
          <span class="tb-section-icon"><i class="pi pi-arrow-left"></i></span>
          <div class="tb-pref-text">
            <strong i18n>Balayer pour revenir</strong>
            <span i18n class="tb-muted">Deux doigts vers la droite sur le pavé tactile reviennent à la page précédente, qui suit les doigts.</span>
          </div>
          <tb-switch [checked]="settings.swipeBack()" (checkedChange)="settings.swipeBack.set($event)" i18n-label label="Balayer pour revenir" />
        </div>
      </div>
    }
  `,
})
export class TbLinuxPreferences {
  protected readonly desktop = inject(DesktopService) as LinuxDesktopService;
  protected readonly settings = inject(LinuxSettings);
  /** The window and the rendering picked here, applied when the app starts again. */
  protected readonly linuxWindow = signal(this.desktop.linuxOptions?.window ?? 'gnome');
  protected readonly linuxRendering = signal(this.desktop.linuxOptions?.rendering ?? 'auto');
  protected readonly linuxChanged = computed(() => {
    const o = this.desktop.linuxOptions;
    return !!o && (this.linuxWindow() !== o.window || this.linuxRendering() !== o.rendering);
  });

  protected restartLinux(): void {
    void this.desktop.setLinuxOptions(this.linuxWindow(), this.linuxRendering());
  }
}
