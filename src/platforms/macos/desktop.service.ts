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
    this.fillSliders();
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

  /**
   * The sliders: how far the knob is (--p), for the part of the track filled in the accent colour
   * (macos.css, Sliders): on each move, and for each slider that comes into the page.
   */
  private fillSliders(): void {
    const fill = (input: HTMLInputElement) => {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const p = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--p', `${Math.min(100, Math.max(0, p))}%`);
    };
    const all = () => this.doc.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fill);
    this.doc.addEventListener('input', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'range') fill(e.target);
    }, true);
    let frame = 0;
    new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), all()));
    }).observe(this.doc.body, { childList: true, subtree: true });
    all();
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
