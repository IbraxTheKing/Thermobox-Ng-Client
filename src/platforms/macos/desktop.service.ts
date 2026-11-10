import { Injectable, computed } from '@angular/core';

import { TauriDesktopService } from '../desktop/desktop.service';

/**
 * The macOS app: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,), in a window
 * of their own; « À propos de Thermobox » (of that menu, or a link of the page) opens a small
 * window of its own, the About page drawn as Thermobox (index.html?view=about). The page is under the title bar, the traffic lights over the
 * side bar (which moves the window).
 */
@Injectable()
export class MacDesktopService extends TauriDesktopService {
  override readonly name = computed(() => 'macOS');
  override readonly settingsWindow = this.doc.documentElement.dataset['desktopWindow'] === 'settings';
  /** The About window (index.html?view=about). */
  readonly aboutWindow = this.doc.documentElement.dataset['desktopWindow'] === 'about';
  /** A window of its own (settings, About): no side bar, no history of pages. */
  readonly ownWindow = this.settingsWindow || this.aboutWindow;
  override readonly dragRail = true;

  override start(): void {
    super.start();
    // The links to « À propos » of the page (the login page, Préférences): the panel instead
    this.doc.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href]');
        if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
        const path = new URL((a as HTMLAnchorElement).href, location.href).pathname;
        if (path !== '/about' && path !== '/app/about') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        void this.openAbout();
      },
      true,
    );
  }

  /** The About window, or brought to the front. */
  async openAbout(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('about_window').catch(() => undefined);
  }

  /** The settings window, or brought to the front. */
  override async openSettings(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('settings_window');
  }
}
