import { Injectable, computed } from '@angular/core';

import { TauriDesktopService } from '../desktop/desktop.service';
import { showAbout } from './about';

/**
 * The macOS app: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,), in a window
 * of their own; « À propos de Thermobox » (of that menu, or a link of the page) opens the About
 * panel of the system (about.ts). The page is under the title bar, the traffic lights over the
 * side bar (which moves the window).
 */
@Injectable()
export class MacDesktopService extends TauriDesktopService {
  override readonly name = computed(() => 'macOS');
  override readonly settingsWindow = this.doc.documentElement.dataset['desktopWindow'] === 'settings';
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

  /** The About panel of macOS, with the versions of the moment. */
  openAbout(): Promise<void> {
    return showAbout(this.injector).catch(() => undefined);
  }

  /** The settings window, or brought to the front. */
  override async openSettings(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('settings_window');
  }

  protected override async listen(): Promise<void> {
    const { listen } = await import('@tauri-apps/api/event');
    // « À propos de Thermobox » of the menu bar
    await listen<string>('tb-open', (e) => {
      if (e.payload === 'about') void this.openAbout();
    });
  }
}
