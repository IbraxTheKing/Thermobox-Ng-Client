import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

import { DesktopService } from '../core/desktop';
import { TitleService } from '../core/title';

/**
 * The frame of the desktop app, drawn by the page:
 *
 * - Windows: the title bar of WinUI 3 (32 px, the icon and the name on the left, the three
 *   caption buttons of Segoe Fluent Icons on the right, close in red). The page scrolls under it,
 *   blurred. The pointer resting on « maximize » opens the snap layouts of Windows 11.
 * - macOS: a strip to drag the window by, under the traffic lights (the page is under the title
 *   bar, tauri.macos.conf.json).
 * - Linux: nothing, the desktop draws the title bar.
 */
@Component({
  selector: 'tb-desktop-chrome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (desktop.windows) {
      <header class="tb-titlebar" [class.tb-titlebar-scrolled]="scrolled()" [class.tb-titlebar-inactive]="!focused()" data-tauri-drag-region>
        <span class="tb-titlebar-icon" aria-hidden="true"></span>
        <span class="tb-titlebar-title">Thermobox@if (pageTitle.title(); as t) {<span class="tb-titlebar-page"> · {{ t }}</span>}</span>
        <div class="tb-titlebar-buttons">
          <button type="button" class="tb-caption" tabindex="-1" aria-label="Réduire" title="Réduire" (click)="desktop.minimize()">&#xE921;</button>
          <button type="button" class="tb-caption" tabindex="-1" [attr.aria-label]="desktop.maximized() ? 'Niveau inférieur' : 'Agrandir'"
                  [title]="desktop.maximized() ? 'Niveau inférieur' : 'Agrandir'"
                  (click)="maximize()" (pointerenter)="snapSoon()" (pointerleave)="snapCancel()">{{ desktop.maximized() ? '&#xE923;' : '&#xE922;' }}</button>
          <button type="button" class="tb-caption tb-caption-close" tabindex="-1" aria-label="Fermer" title="Fermer" (click)="desktop.close()">&#xE8BB;</button>
        </div>
      </header>
    } @else if (desktop.mac) {
      <div class="tb-mac-drag" data-tauri-drag-region aria-hidden="true"></div>
    }
  `,
})
export class TbDesktopChrome {
  protected readonly desktop = inject(DesktopService);
  protected readonly pageTitle = inject(TitleService);
  protected readonly scrolled = signal(false);
  protected readonly focused = signal(document.hasFocus());
  private snapTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    if (!this.desktop.windows) return;
    const onScroll = () => this.scrolled.set(scrollY > 2);
    const onFocus = () => this.focused.set(true);
    const onBlur = () => this.focused.set(false);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('focus', onFocus);
    addEventListener('blur', onBlur);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener('scroll', onScroll);
      removeEventListener('focus', onFocus);
      removeEventListener('blur', onBlur);
    });
  }

  protected maximize(): void {
    this.snapCancel();
    void this.desktop.toggleMaximize();
  }

  /** As the native button: the layouts once the pointer has rested a moment on it. */
  protected snapSoon(): void {
    this.snapCancel();
    this.snapTimer = setTimeout(() => void this.desktop.snapLayouts(), 650);
  }

  protected snapCancel(): void {
    clearTimeout(this.snapTimer);
  }
}
