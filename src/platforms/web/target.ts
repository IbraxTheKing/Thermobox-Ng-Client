import { PlatformTarget, WEB_TRAITS } from '../target';

/**
 * The web client: the shared client as it is. On a phone, the navigation takes the look of its
 * system by the user agent (PlatformService: the styles of iOS and Android are in its build).
 */
export const TARGET: PlatformTarget = {
  name: 'web',
  desktopOs: null,
  providers: [],
  rootComponents: [],
  rootOverlays: [],
  appearanceRows: [],
  preferenceGroups: [],
  traits: WEB_TRAITS,
};
