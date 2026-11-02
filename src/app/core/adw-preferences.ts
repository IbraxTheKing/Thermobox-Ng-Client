import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { DESKTOP_OS } from './tauri';

/**
 * The Linux app: Préférences are an AdwPreferencesDialog, as in the GNOME apps (Fichiers,
 * Paramètres…), over the page where they were asked, not a page of their own. Every way there
 * (main menu, links, shortcuts, the « Paramètres » of the login page) goes through the routes
 * /app/preferences and /settings: their guard opens the dialog instead.
 */
@Injectable({ providedIn: 'root' })
export class AdwPreferencesService {
  readonly open = signal(false);
  /** From the login page: the settings of this device only (no À propos, no notifications). */
  readonly standalone = signal(false);

  show(standalone: boolean): void {
    this.standalone.set(standalone);
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }
}

/** Linux: Préférences open as a dialog; the page stays where it is. */
export const adwPreferencesGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  if (DESKTOP_OS !== 'linux') return true;
  const router = inject(Router);
  const standalone = route.data['standalone'] === true;
  inject(AdwPreferencesService).show(standalone);
  // Opened from nowhere (the app started on that address): the page it belongs over
  if (!router.navigated) return router.parseUrl(standalone ? '/login' : '/app/overview');
  return false;
};
