import { SYSTEM_ACCENT } from '../../app/core/accent';
import { DesktopService } from '../../app/core/desktop';
import { PAGE_MOTION } from '../../app/core/page-motion';
import { rustAccent } from '../desktop/accent';
import { installMenus } from '../desktop/menus';
import { prepareTauri } from '../desktop/prepare';
import { PlatformTarget, WEB_TRAITS } from '../target';
import { WindowsDesktopService, applyAcrylic } from './desktop.service';
import { trackPointer, winuiMenus } from './menus';
import { WindowsMotion } from './motion';
import { TbWindowsPreferences } from './preferences';
import { readWindowsSettings } from './settings';
import { TbWindowsTitlebar } from './titlebar';

/**
 * The Windows app (Tauri): Fluent 2 / WinUI 3 (windows.css). Its title bar is the page's
 * (titlebar.ts, index.html until Angular is there), the Acrylic of Windows 11 behind it, its menus
 * and lists are flyouts of WinUI (menus.ts), its pages enter as the Frame of WinUI (motion.ts).
 */
export const TARGET: PlatformTarget = {
  name: 'windows',
  desktopOs: 'windows',
  async prepare() {
    document.documentElement.dataset['desktop'] = 'windows';
    // The blur chosen in Préférences (on by default), before Angular: not awaited, Angular starts
    // meanwhile
    void applyAcrylic(readWindowsSettings().blur ?? true);
    installMenus(document, winuiMenus);
    trackPointer();
    // The page calls the server itself (http://tauri.localhost), through Rust only without CORS
    await prepareTauri('windows', true);
  },
  providers: [
    { provide: DesktopService, useClass: WindowsDesktopService },
    { provide: PAGE_MOTION, useClass: WindowsMotion },
    { provide: SYSTEM_ACCENT, useValue: rustAccent },
  ],
  rootComponents: [TbWindowsTitlebar],
  rootOverlays: [],
  appearanceRows: [TbWindowsPreferences],
  preferenceGroups: [],
  traits: {
    ...WEB_TRAITS,
    overlayPane: true,
    instantTheme: true,
    chartsAnimate: false,
    chartFont: { family: '"Segoe UI Variable Text", "Segoe UI", sans-serif', size: 12 },
    guideTip: true,
  },
};
