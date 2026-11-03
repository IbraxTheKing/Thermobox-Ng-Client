import { SYSTEM_ACCENT } from '../../app/core/accent';
import { PlatformTarget, WEB_TRAITS } from '../target';

/** The iOS app (Capacitor): Liquid Glass, drawn by the page (shell-ios.css, theme-ios.css). */
export const TARGET: PlatformTarget = {
  name: 'ios',
  desktopOs: null,
  providers: [
    // iOS gives no accent colour to the apps
    { provide: SYSTEM_ACCENT, useValue: { read: async () => null, why: $localize`iOS ne donne pas sa couleur d'accent aux applications.` } },
  ],
  rootComponents: [],
  rootOverlays: [],
  appearanceRows: [],
  preferenceGroups: [],
  traits: WEB_TRAITS,
};
