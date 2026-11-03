import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, effect, inject, runInInjectionContext } from '@angular/core';

import { DesktopService, SystemNotification } from '../../app/core/desktop';
import { language } from '../../app/core/i18n';
import { PreferencesService } from '../../app/core/preferences';

/**
 * What the three desktop apps (Tauri) share, in the place of the web's DesktopService
 * (TARGET.providers); each system completes it (platforms/windows, macos, linux):
 * - the links to other sites open in the browser of the system;
 * - the preferences changed in one window apply at once in the others (the settings window of
 *   macOS);
 * - the menu bar of macOS and the titles of the windows in the language of the page;
 * - the window itself: minimize, maximize, close, its theme;
 * - the notifications of the system, the images of the server fetched through Rust.
 */
@Injectable()
export class TauriDesktopService extends DesktopService {
  protected readonly doc = inject(DOCUMENT);
  protected readonly injector = inject(Injector);
  override readonly active = true;

  override start(): void {
    // The menu bar of macOS and the titles of the windows in the language of the page
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('app_language', { lang: language() }).catch(() => undefined));
    // External links: the browser of the system, not a window of the app
    this.doc.addEventListener('click', (e) => this.externalLink(e), true);
    this.syncPreferences();
    void this.listen();
  }

  protected async listen(): Promise<void> {
    const { listen } = await import('@tauri-apps/api/event');
    // « À propos de Thermobox » of the menu bar (macOS)
    await listen<string>('tb-open', (e) => {
      if (e.payload === 'about') void this.router.navigateByUrl(this.auth.user() ? '/app/about' : '/about');
    });
  }

  /** The window fills the screen or not, followed (the systems whose page draws the title bar). */
  protected async followMaximized(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    this.maximized.set(await w.isMaximized());
    await w.onResized(async () => this.maximized.set(await w.isMaximized()));
  }

  /** The other windows of the app learn that the preferences changed, and this one from them. */
  private syncPreferences(): void {
    const prefs = this.injector.get(PreferencesService);
    void import('@tauri-apps/api/event').then((e) => e.listen('tb-preferences', () => prefs.reload()));
    runInInjectionContext(this.injector, () =>
      effect(() => {
        if (prefs.saves()) void import('@tauri-apps/api/event').then((e) => e.emit('tb-preferences'));
      }),
    );
  }

  override async windowTheme(choice: 'light' | 'dark' | 'auto', shown: 'light' | 'dark'): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('window_theme', { theme: choice === 'auto' ? null : choice, dark: shown === 'dark' });
  }

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

  override async notify(texts: SystemNotification[]): Promise<void> {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    for (const n of texts) sendNotification({ title: n.title, body: n.body });
  }

  override async notificationPermission(ask: boolean): Promise<boolean> {
    const n = await import('@tauri-apps/plugin-notification');
    if (await n.isPermissionGranted()) return true;
    return ask && (await n.requestPermission()) === 'granted';
  }

  private readonly images = new Map<string, Promise<string>>();

  /**
   * An image of a ThermoBox server: fetched through Rust (as the API calls, prepareTauri), shown
   * from memory. The tauri:// page of macOS and Linux would not load an http:// image of the
   * local network itself.
   */
  override imageSource(url: string): Promise<string> {
    if (!/^https?:/i.test(url)) return Promise.resolve(url);
    let p = this.images.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => URL.createObjectURL(b));
      p.catch(() => this.images.delete(url));
      this.images.set(url, p);
    }
    return p;
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
