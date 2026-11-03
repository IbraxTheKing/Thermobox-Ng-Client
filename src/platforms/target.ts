import { EnvironmentProviders, Provider, Type } from '@angular/core';

/**
 * The platforms the client is built for. One idea, the web client (src/app, src/styles), and
 * for each platform what is its own, in src/platforms/<name>/: its stylesheets, its services,
 * its components. A build is made for one platform (npm run build -- --target linux…): it holds
 * the shared client and that platform only (angular.json: its styles, and current.ts replaced by
 * current.<name>.ts). docs/platforms.md.
 *
 * - web: the browsers; on a phone, the looks of iOS and Android (shell-ios.css,
 *   shell-android.css) by the user agent, as before
 * - android, ios: the apps of the stores (Capacitor)
 * - windows, macos, linux: the desktop apps (Tauri, src-tauri/), platforms/desktop/ for what the
 *   three share
 */
export type TargetName = 'web' | 'android' | 'ios' | 'windows' | 'macos' | 'linux';

/** The system of a desktop app. */
export type DesktopOs = 'windows' | 'macos' | 'linux';

/**
 * What the shared client asks of the platform it is built for. Facts (traits) and the pieces of
 * the platform: services put in the place of the shared ones (providers), components put in the
 * app (rootComponents) and in Préférences.
 */
export interface PlatformTarget {
  readonly name: TargetName;
  /** The desktop app of this system (Tauri); null for the web and the mobile apps. */
  readonly desktopOs: DesktopOs | null;
  /** Before Angular starts (main.ts, once the language is loaded). */
  readonly prepare?: () => Promise<void>;
  /** Services of the platform, in the place of the shared ones or beside them. */
  readonly providers: (Provider | EnvironmentProviders)[];
  /** Put in the root of the app (app.ts), before the toasts: the frame of the window. */
  readonly rootComponents: Type<unknown>[];
  /** Put in the root of the app after its dialogs: the dialogs of the system. */
  readonly rootOverlays: Type<unknown>[];
  /** Préférences: rows at the end of « Apparence », then groups of their own. */
  readonly appearanceRows: Type<unknown>[];
  readonly preferenceGroups: Type<unknown>[];
  readonly traits: PlatformTraits;
}

export interface PlatformTraits {
  /** The settings are in the menu bar of the system, in a window of their own (macOS). */
  readonly settingsInMenu: boolean;
  /**
   * The side bar of computers opens over the page below 1200 px and folds at once, without a
   * picture morphing (NavigationView of WinUI, AdwOverlaySplitView of GNOME).
   */
  readonly overlayPane: boolean;
  /** The theme changes at once (no circle spreading from the button). */
  readonly instantTheme: boolean;
  /** The curves of the charts draw themselves. */
  readonly chartsAnimate: boolean;
  /** The type of the texts of the charts on a computer; null: ThermoBox's. */
  readonly chartFont: { family: string; size: number } | null;
  /** The onboarding guide as a TeachingTip of WinUI 3 (beside what it shows). */
  readonly guideTip: boolean;
}

/** The traits of the web, that the platforms change where they differ. */
export const WEB_TRAITS: PlatformTraits = {
  settingsInMenu: false,
  overlayPane: false,
  instantTheme: false,
  chartsAnimate: true,
  chartFont: null,
  guideTip: false,
};
