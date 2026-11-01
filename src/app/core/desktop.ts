import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from './auth';
import { DESKTOP_OS, TAURI } from './tauri';

export { DESKTOP_OS, TAURI } from './tauri';
export type { DesktopOs } from './tauri';

/**
 * Before Angular starts (main.ts), in the desktop app:
 * - the calls to a ThermoBox server go through Rust (tauri-plugin-http): no CORS, and no mixed
 *   content between the tauri:// page of macOS / Linux and a server in plain http on the local
 *   network. The page's own files stay with the webview.
 * - the settings window (macOS) opens on index.html?view=settings: its page is /settings.
 * - Windows 11: the window has the Acrylic backdrop of the system (main.rs): html[data-backdrop]
 *   leaves the side bar and the title bar clear for it (windows.css).
 */
export async function prepareDesktop(): Promise<void> {
  if (!TAURI) return;
  document.documentElement.dataset['desktop'] = DESKTOP_OS!;
  if (DESKTOP_OS === 'windows') {
    const { invoke } = await import('@tauri-apps/api/core');
    const backdrop = await invoke<string | null>('window_backdrop').catch(() => null);
    if (backdrop) document.documentElement.dataset['backdrop'] = backdrop;
  }
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'settings') {
    document.documentElement.dataset['desktopWindow'] = 'settings';
    history.replaceState(null, '', '/settings');
  }
  const { fetch: rustFetch } = await import('@tauri-apps/plugin-http');
  const own = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let outside = false;
    try {
      const u = new URL(url, location.href);
      outside = /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch {
      /* not a URL: the page's */
    }
    if (!outside) return own(input, init);
    // Unreachable server: a TypeError as the fetch of a browser (« Le serveur ne répond pas »)
    return rustFetch(input, init).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new TypeError(e instanceof Error ? e.message : String(e));
    });
  };
}

/**
 * What the desktop app changes in the page:
 * - macOS: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,), in a window of
 *   their own; « À propos de Thermobox » of that menu opens the About page here.
 * - Windows: the title bar is drawn by the page (TbDesktopTitlebar), in the WinUI 3 style.
 * - the links to other sites open in the browser of the system.
 * - the preferences changed in the settings window apply at once in the main one.
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly os = DESKTOP_OS;
  readonly active = TAURI;
  readonly mac = DESKTOP_OS === 'macos';
  readonly windows = DESKTOP_OS === 'windows';
  readonly linux = DESKTOP_OS === 'linux';
  /** macOS: the settings live in the menu bar, not in the page. */
  readonly settingsInMenu = this.mac;
  /** This window is the settings window (macOS). */
  readonly settingsWindow = this.doc.documentElement.dataset['desktopWindow'] === 'settings';

  /** Windows: the button of the title bar that opens or folds the side bar (the shell listens). */
  readonly paneToggles = signal(0);

  togglePane(): void {
    this.paneToggles.update((n) => n + 1);
  }

  /** Windows: the window fills the screen (the maximize button becomes « restore »). */
  readonly maximized = signal(false);
  readonly name = computed(() => ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' })[this.os ?? 'linux']);

  start(): void {
    if (!this.active) return;
    // External links: the browser of the system, not a window of the app
    this.doc.addEventListener('click', (e) => this.externalLink(e), true);
    void this.listen();
  }

  private async listen(): Promise<void> {
    const { listen } = await import('@tauri-apps/api/event');
    // « À propos de Thermobox » of the menu bar (macOS)
    await listen<string>('tb-open', (e) => {
      if (e.payload === 'about') void this.router.navigateByUrl(this.auth.user() ? '/app/about' : '/about');
    });
    if (this.windows) {
      // (index.html has already told main.rs that the page draws its title bar)
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      this.maximized.set(await w.isMaximized());
      await w.onResized(async () => this.maximized.set(await w.isMaximized()));
    }
  }

  /** Windows: the theme shown by the page for the window (the tint of its Acrylic). */
  async windowTheme(theme: 'light' | 'dark'): Promise<void> {
    if (!this.windows) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('window_theme', { theme });
  }

  /** The settings: their window on macOS, the page elsewhere. */
  async openSettings(): Promise<void> {
    if (this.settingsInMenu) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('settings_window');
      return;
    }
    await this.router.navigateByUrl(this.auth.user() ? '/app/preferences' : '/settings');
  }

  // ---------------------------------------------------------------- window (Windows title bar)

  async minimize(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  }

  async toggleMaximize(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  }

  async close(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }

  /** Windows 11: the snap layouts, as a native maximize button shows them under the pointer. */
  async snapLayouts(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('snap_layouts');
  }

  /** The other windows of the app learn that the preferences changed (PreferencesService). */
  async broadcastPreferences(): Promise<void> {
    if (!this.active) return;
    const { emit } = await import('@tauri-apps/api/event');
    await emit('tb-preferences');
  }

  async onPreferences(apply: () => void): Promise<void> {
    if (!this.active) return;
    const { listen } = await import('@tauri-apps/api/event');
    await listen('tb-preferences', apply);
  }

  private externalLink(e: MouseEvent): void {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.href;
    if (!/^(https?:|mailto:)/.test(href)) return;
    try {
      if (new URL(href).origin === location.origin) return;
    } catch {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    void import('@tauri-apps/plugin-opener').then((o) => o.openUrl(href));
  }
}
