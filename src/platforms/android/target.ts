import { SYSTEM_ACCENT } from '../../app/core/accent';
import { NativeBar, NativeUi } from '../../app/core/native-ui';
import { PlatformTarget, WEB_TRAITS } from '../target';
import { AndroidNativeService, AndroidNativeUi, androidAccent } from './native';

/**
 * The Android app (Capacitor): Material 3. Its navigation bar, its main action button, its menus,
 * snackbars and dialogs are native components laid over the page (native.ts, the plugin
 * ThermoboxNative), the accent colour the Material You of the wallpaper.
 */
export const TARGET: PlatformTarget = {
  name: 'android',
  desktopOs: null,
  providers: [
    { provide: NativeUi, useClass: AndroidNativeUi },
    { provide: NativeBar, useClass: AndroidNativeService },
    { provide: SYSTEM_ACCENT, useValue: androidAccent },
  ],
  rootComponents: [],
  rootOverlays: [],
  appearanceRows: [],
  preferenceGroups: [],
  traits: WEB_TRAITS,
};
