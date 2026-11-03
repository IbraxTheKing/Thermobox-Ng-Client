import { SYSTEM_ACCENT, browserAccent } from '../../app/core/accent';
import { DesktopService } from '../../app/core/desktop';
import { DESKTOP_ACCENT_WHY } from '../desktop/accent';
import { installMenus, tauriMenus } from '../desktop/menus';
import { prepareTauri } from '../desktop/prepare';
import { PlatformTarget, WEB_TRAITS } from '../target';
import { MacDesktopService } from './desktop.service';
import { TbMacDrag } from './drag';

/**
 * The macOS app (Tauri): the page under the title bar, the traffic lights over the side bar
 * (macos.css, drag.ts), its menus those of macOS. The settings are in the menu bar, in a window
 * of their own (index.html?view=settings, whose page is /settings).
 */
export const TARGET: PlatformTarget = {
  name: 'macos',
  desktopOs: 'macos',
  async prepare() {
    if (new URLSearchParams(location.search).get('view') === 'settings') {
      document.documentElement.dataset['desktopWindow'] = 'settings';
      history.replaceState(null, '', '/settings');
    }
    installMenus(document, tauriMenus);
    await prepareTauri('macos');
  },
  providers: [
    { provide: DesktopService, useClass: MacDesktopService },
    // The WebKit of macOS gives AccentColor
    { provide: SYSTEM_ACCENT, useValue: { read: browserAccent, why: DESKTOP_ACCENT_WHY } },
  ],
  rootComponents: [TbMacDrag],
  rootOverlays: [],
  appearanceRows: [],
  preferenceGroups: [],
  traits: { ...WEB_TRAITS, settingsInMenu: true },
};
