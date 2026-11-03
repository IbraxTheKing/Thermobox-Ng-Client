import { SystemAccentSource } from '../../app/core/accent';

/** Why a desktop app has no accent colour of its system, for the Préférences page. */
export const DESKTOP_ACCENT_WHY = $localize`Ce système ne donne pas sa couleur d'accent à l'application.`;

/**
 * The accent colour given by Rust (system_accent): the colour of Windows (Settings ›
 * Personalisation: WebView2 has no AccentColor), the accent of GNOME 47 and later.
 */
export const rustAccent: Omit<SystemAccentSource, 'watch'> = {
  async read() {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('system_accent');
  },
  why: DESKTOP_ACCENT_WHY,
};
