import { Injectable, computed, signal } from '@angular/core';

import { TauriDesktopService } from '../desktop/desktop.service';

/** The window and the rendering chosen, what the desktop says (linux.rs, before the page). */
export interface LinuxOptions {
  /** « gnome »: drawn by the page (GTK 4 look); « gtk3 »: the window of the system. */
  window: 'gnome' | 'gtk3';
  rendering: 'auto' | 'gpu' | 'cpu';
  /** WebKitGTK draws with the processor now. */
  software: boolean;
  /** « auto » picks the processor on this computer (no graphics card: virtual machine, WSL). */
  autoSoftware: boolean;
  /** gtk-decoration-layout, « appmenu:minimize,maximize,close ». */
  layout: string | null;
  /** The touchpad scrolls the content with the fingers. */
  naturalScroll: boolean;
}

/** The window of the system: the title, back, the sidebar button, the main menu. */
export interface NativeChrome {
  title: string;
  back: { label: string; shown: boolean };
  sidebar: { label: string; shown: boolean };
  menuLabel: string;
  /** An empty label: a separator. */
  menu: { id: string; label: string }[];
}

/** The buttons of the windows before and after the title. */
export interface WindowButtons {
  start: string[];
  end: string[];
}

/** « appmenu:minimize,maximize,close » → the buttons before and after the title. */
export function parseLayout(layout: string | null | undefined): WindowButtons {
  if (!layout) return { start: [], end: ['minimize', 'maximize', 'close'] };
  const known = (part: string | undefined) =>
    (part ?? '')
      .split(',')
      .map((b) => b.trim())
      .filter((b) => ['minimize', 'maximize', 'close'].includes(b));
  const [start, end] = layout.split(':');
  return { start: known(start), end: known(end) };
}

/** The close button at the start: the dialogs put theirs there too (as libadwaita). */
export function closeAtStart(b: WindowButtons): boolean {
  return b.start.includes('close');
}

/** Read before Angular starts (target.ts). */
let options: LinuxOptions | null = null;

export async function readLinuxOptions(): Promise<LinuxOptions | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  options = await invoke<LinuxOptions | null>('linux_options').catch(() => null);
  return options;
}

/**
 * The Linux app: the header bar is the page's (headerbar.ts) in the style of GNOME, or the native
 * one of GTK 3 (Préférences › Fenêtre); where the buttons of the windows go and how the touchpad
 * scrolls, followed while the app runs.
 */
@Injectable()
export class LinuxDesktopService extends TauriDesktopService {
  override readonly name = computed(() => $localize`Linux`);

  /** The window, the rendering, the desktop (linux.rs), as they were at start. */
  readonly linuxOptions = options;
  /** The window of the system (GTK 3) and its native header bar, not the page's. */
  readonly nativeChrome = options?.window === 'gtk3';
  /** Where the buttons of the windows are, followed while the app runs. */
  readonly windowButtons = signal<WindowButtons>(parseLayout(options?.layout));
  /** The touchpad scrolls « naturally » (two fingers to the right go back). */
  readonly naturalScroll = signal(options?.naturalScroll ?? true);
  /** The window of the system: what its buttons and its menu ask (« back », an id…). */
  private nativeHandlers: ((what: string) => void)[] = [];

  onNative(fn: (what: string) => void): void {
    this.nativeHandlers.push(fn);
  }

  /** The window of the system: what its native header bar shows (linux.rs). */
  async setNativeChrome(chrome: NativeChrome): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('native_chrome', { chrome }).catch(() => undefined);
  }

  /** Préférences › Fenêtre, Rendu: stored by linux.rs, then the app starts again with them. */
  async setLinuxOptions(window: LinuxOptions['window'], rendering: LinuxOptions['rendering']): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_linux_options', { window, rendering });
  }

  protected override async listen(): Promise<void> {
    await super.listen();
    const { listen } = await import('@tauri-apps/api/event');
    await listen<string | null>('linux-layout', (e) => this.applyLayout(e.payload));
    await listen<boolean>('linux-input', (e) => this.naturalScroll.set(e.payload));
    await listen<string>('tb-native', (e) => this.nativeHandlers.forEach((fn) => fn(e.payload)));
    // The page draws the title bar (not with the window of the system)
    if (!this.nativeChrome) await this.followMaximized();
  }

  /**
   * The page is there (main.rs then takes away the title bar of the desktop, unless the window of
   * the system was chosen); where the desktop puts the buttons of the windows, read again
   * (« appmenu:minimize,maximize,close »).
   */
  async linuxReady(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('page_ready').catch(() => undefined);
    const layout = await invoke<string | null>('decoration_layout').catch(() => null);
    if (layout) this.applyLayout(layout);
  }

  private applyLayout(layout: string | null): void {
    const b = parseLayout(layout);
    this.windowButtons.set(b);
    this.doc.documentElement.dataset['buttons'] = closeAtStart(b) ? 'start' : 'end';
  }
}
