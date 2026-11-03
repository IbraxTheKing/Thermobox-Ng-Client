import { Injectable, computed } from '@angular/core';

import { TauriDesktopService } from '../desktop/desktop.service';

/**
 * The macOS app: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,), in a window
 * of their own; « À propos de Thermobox » of that menu opens the About page here. The page is
 * under the title bar, the traffic lights over the side bar (which moves the window).
 */
@Injectable()
export class MacDesktopService extends TauriDesktopService {
  override readonly name = computed(() => 'macOS');
  override readonly settingsWindow = this.doc.documentElement.dataset['desktopWindow'] === 'settings';
  override readonly dragRail = true;

  /** The settings window, or brought to the front. */
  override async openSettings(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('settings_window');
  }
}
