import { SYSTEM_ACCENT, browserAccent } from '../../app/core/accent';
import { DesktopService } from '../../app/core/desktop';
import { DESKTOP_ACCENT_WHY } from '../desktop/accent';
import { installMenus, tauriMenus } from '../desktop/menus';
import { prepareTauri } from '../desktop/prepare';
import { PlatformTarget, WEB_TRAITS } from '../target';
import { MacDesktopService } from './desktop.service';
import { TbMacToolbar } from './toolbar';

/**
 * The macOS app (Tauri), as an app of the system: the side bar from the top of the window with the
 * traffic lights in its corner, a unified toolbar over the content (toolbar.ts), the controls of
 * AppKit (macos.css), its menus those of macOS. The settings are in the menu bar, in a window of
 * their own (index.html?view=settings, whose page is /settings).
 *
 * Two looks, as the system the app runs on:
 * - macOS 26 (Tahoe) and up, html[data-mac="tahoe"]: Liquid Glass behind the window, the side bar
 *   floating in it, capsules of glass in the toolbar;
 * - macOS 11 to 15, html[data-mac="classic"]: the vibrancy of a side bar, the toolbar of Big Sur.
 * html[data-backdrop="glass" | "vibrancy"]: the material the window has (main.rs, mac_style);
 * without one, the page paints the side bar itself.
 */
export const TARGET: PlatformTarget = {
  name: 'macos',
  desktopOs: 'macos',
  async prepare() {
    // The windows of their own: the settings (/settings), About (/about)
    const view = new URLSearchParams(location.search).get('view');
    if (view === 'settings' || view === 'about') {
      document.documentElement.dataset['desktopWindow'] = view;
      history.replaceState(null, '', `/${view}`);
    }
    // The pages as on iOS, in the frame of the Mac (ios-look.css)
    document.documentElement.dataset['look'] = 'ios';
    await macStyle();
    installMenus(document, tauriMenus);
    await prepareTauri('macos');
  },
  providers: [
    { provide: DesktopService, useClass: MacDesktopService },
    // The WebKit of macOS gives AccentColor
    { provide: SYSTEM_ACCENT, useValue: { read: browserAccent, why: DESKTOP_ACCENT_WHY } },
  ],
  rootComponents: [TbMacToolbar],
  rootOverlays: [],
  appearanceRows: [],
  preferenceGroups: [],
  traits: { ...WEB_TRAITS, settingsInMenu: true },
};

/** html[data-mac], html[data-backdrop]: the look of the system, the material of the window. */
async function macStyle(): Promise<void> {
  const root = document.documentElement;
  let style: MacStyle | null = null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    style = await invoke<MacStyle | null>('mac_style');
  } catch {
    /* an older app, or the page in a browser (ng serve): the version told by WebKit */
  }
  const version = style?.version || webkitMacVersion();
  root.dataset['mac'] = version >= 26 ? 'tahoe' : 'classic';
  if (style?.backdrop) root.dataset['backdrop'] = style.backdrop;
  // The toolbar centred on the traffic lights, its first button after them, wherever this macOS
  // draws them (macos.css: --mac-lights-middle, --mac-after-lights)
  const lights = style?.lights;
  if (lights && lights.middle > 6 && lights.middle < 40 && lights.right > 30 && lights.right < 160) {
    root.style.setProperty('--mac-lights-middle', `${Math.round(lights.middle)}px`);
    root.style.setProperty('--mac-after-lights', `${Math.round(lights.right + 12)}px`);
  }
}

/** What main.rs (mac_style) says of the window. */
interface MacStyle {
  backdrop?: string;
  version?: number;
  /** The traffic lights, in points from the top left corner of the window. */
  lights?: { left: number; right: number; middle: number } | null;
}

/** The version of macOS in the user agent of WebKit (frozen at 10_15_7 by Safari: 0 then). */
function webkitMacVersion(): number {
  const m = /Mac OS X (\d+)[._](\d+)/.exec(navigator.userAgent);
  const major = m ? Number(m[1]) : 0;
  return major > 10 ? major : 0;
}
