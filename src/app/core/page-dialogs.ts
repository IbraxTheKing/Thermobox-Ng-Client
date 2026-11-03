import { InjectionToken, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, UrlTree } from '@angular/router';

/**
 * Pages that a platform opens as a dialog of its own instead, over the page where they were asked
 * (the Linux app: Préférences and À propos as dialogs of libadwaita, platforms/linux/). Their
 * routes have pageDialogGuard.
 */
export interface PageDialogs {
  /** Opens the dialog of [route]: false (or a page to show under it), true to open the page. */
  open(route: ActivatedRouteSnapshot): boolean | UrlTree;
}

export const PAGE_DIALOGS = new InjectionToken<PageDialogs | null>('page dialogs', {
  providedIn: 'root',
  factory: () => null,
});

/** The page, or the platform's dialog in its place. */
export const pageDialogGuard: CanActivateFn = (route) => inject(PAGE_DIALOGS)?.open(route) ?? true;
