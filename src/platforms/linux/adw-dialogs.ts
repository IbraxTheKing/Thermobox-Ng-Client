import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';

import { PageDialogs } from '../../app/core/page-dialogs';

/** What the dialog shows: Préférences (AdwPreferencesDialog) or À propos (AdwAboutDialog). */
export type AdwDialogKind = 'preferences' | 'about';

/**
 * The Linux app: Préférences and À propos are dialogs of libadwaita, as in the GNOME apps
 * (Fichiers, Paramètres…), over the page where they were asked, not pages of their own. Every
 * way there (main menu, links, shortcuts, the buttons of the login page) goes through their routes
 * (/app/preferences, /settings, /app/about, /about): their guard opens the dialog instead
 * (PAGE_DIALOGS: AdwPageDialogs). The dialog itself: adw-dialog.ts.
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

/** Préférences and À propos open as a dialog; the page stays where it is. */
@Injectable()
export class AdwPageDialogs implements PageDialogs {
  private readonly router = inject(Router);
  private readonly dialogs = inject(AdwDialogsService);

  open(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const standalone = route.data['standalone'] === true;
    const kind: AdwDialogKind = route.routeConfig?.path === 'about' ? 'about' : 'preferences';
    this.dialogs.show(kind, standalone);
    // Opened from nowhere (the app started on that address): the page it belongs over
    if (!this.router.navigated) return this.router.parseUrl(standalone ? '/login' : '/app/overview');
    return false;
  }
}
