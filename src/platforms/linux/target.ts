import { SYSTEM_ACCENT } from '../../app/core/accent';
import { usePalette } from '../../app/core/colors';
import { DesktopService } from '../../app/core/desktop';
import { PAGE_DIALOGS } from '../../app/core/page-dialogs';
import { PAGE_MOTION } from '../../app/core/page-motion';
import { rustAccent } from '../desktop/accent';
import { installMenus, tauriMenus } from '../desktop/menus';
import { prepareTauri } from '../desktop/prepare';
import { PlatformTarget, WEB_TRAITS } from '../target';
import { TbAdwDialog } from './adw-dialog';
import { AdwPageDialogs } from './adw-dialogs';
import { LinuxDesktopService, closeAtStart, parseLayout, readLinuxOptions } from './desktop.service';
import { GNOME_PALETTE } from './gnome-colors';
import { TbLinuxHeaderbar } from './headerbar';
import { LinuxMotion } from './motion';
import { TbLinuxPreferences } from './preferences';

/**
 * The Linux app (Tauri): GNOME, GTK 4 / libadwaita (linux.css, headerbar.css). Its header bar is
 * the page's (headerbar.ts) or the native one of GTK 3 (Préférences › Fenêtre), Préférences and
 * À propos are dialogs of libadwaita (adw-dialog.ts), its pages move as an AdwNavigationView
 * (motion.ts), the states take the colours of GNOME (gnome-colors.ts), its menus are those of GTK.
 */
export const TARGET: PlatformTarget = {
  name: 'linux',
  desktopOs: 'linux',
  async prepare() {
    const root = document.documentElement;
    root.dataset['desktop'] = 'linux';
    // No view transitions: WebKitGTK drawing with the processor (Préférences › Rendu) crashed on
    // one, even skipped at once; the motion of the Linux app is its own (motion.ts), and the
    // router, the theme and the sidebar change without them where they are missing
    delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition;
    // The window chosen (Préférences › Fenêtre), where the desktop puts the buttons of the windows
    const options = await readLinuxOptions();
    if (options?.window === 'gtk3') root.dataset['window'] = 'gtk3';
    // The corners of the window rounded by linux.rs: the page rounds its own as well
    if (options?.cornersRounded) root.dataset['rounded'] = '';
    root.dataset['buttons'] = closeAtStart(parseLayout(options?.layout)) ? 'start' : 'end';
    // The window drawn by the page: the scroll bar of the page drawn as the one of GTK 4, under
    // the header bar (the window of the system keeps the scroll bar of GTK 3, under its own)
    if (options?.window !== 'gtk3') void import('./gtk-scrollbar').then((m) => m.gtkScrollbar(document));
    usePalette(GNOME_PALETTE);
    installMenus(document, tauriMenus);
    await prepareTauri('linux');
  },
  providers: [
    { provide: DesktopService, useClass: LinuxDesktopService },
    { provide: PAGE_MOTION, useClass: LinuxMotion },
    { provide: PAGE_DIALOGS, useClass: AdwPageDialogs },
    {
      provide: SYSTEM_ACCENT,
      useValue: {
        ...rustAccent,
        // GNOME: told as soon as the accent changes (linux.rs, watch_appearance)
        watch: (changed: () => void) =>
          void import('@tauri-apps/api/event')
            .then(({ listen }) => listen('system-appearance', changed))
            .catch(() => undefined),
      },
    },
  ],
  rootComponents: [TbLinuxHeaderbar],
  rootOverlays: [TbAdwDialog],
  appearanceRows: [],
  preferenceGroups: [TbLinuxPreferences],
  traits: { ...WEB_TRAITS, overlayPane: true, chartsAnimate: false },
};
