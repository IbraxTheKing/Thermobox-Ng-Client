import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { DESKTOP_OS } from './tauri';

/** What the dialog shows: Préférences (AdwPreferencesDialog) or À propos (AdwAboutDialog). */
export type AdwDialogKind = 'preferences' | 'about';

/**
 * The Linux app: Préférences and À propos are dialogs of libadwaita, as in the GNOME apps
 * (Fichiers, Paramètres…), over the page where they were asked, not pages of their own. Every
 * way there (main menu, links, shortcuts, the buttons of the login page) goes through their routes
 * (/app/preferences, /settings, /app/about, /about): their guard opens the dialog instead.
 */
@Injectable({ providedIn: 'root' })
export class AdwDialogsService {
  readonly open = signal<AdwDialogKind | null>(null);
  /** From the login page: no account (the settings of this device only, no server to ask). */
  readonly standalone = signal(false);
  /** Counts the openings: a link that opened the other dialog does not close it. */
  shown = 0;

  show(kind: AdwDialogKind, standalone: boolean): void {
    this.shown++;
    this.standalone.set(standalone);
    this.open.set(kind);
  }

  close(): void {
    this.open.set(null);
  }
}

/** Linux: Préférences and À propos open as a dialog; the page stays where it is. */
export const adwDialogGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  if (DESKTOP_OS !== 'linux') return true;
  const router = inject(Router);
  const standalone = route.data['standalone'] === true;
  const kind: AdwDialogKind = route.routeConfig?.path === 'about' ? 'about' : 'preferences';
  inject(AdwDialogsService).show(kind, standalone);
  // Opened from nowhere (the app started on that address): the page it belongs over
  if (!router.navigated) return router.parseUrl(standalone ? '/login' : '/app/overview');
  return false;
};
