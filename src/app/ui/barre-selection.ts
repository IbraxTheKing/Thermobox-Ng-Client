import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject } from '@angular/core';

/**
 * The bar of the ticked rows (.tb-barre) is shown: html.tb-barre-ouverte, for the room left under
 * the page and the floating button that steps aside. A class rather than :has(.tb-barre-on) on
 * the page: such a selector made the browser check the whole page again at every change of a
 * class anywhere in it (each animation, each row), which phones felt. Call in a constructor.
 */
export function suivreBarreSelection(ouverte: () => boolean): void {
  const root = inject(DOCUMENT).documentElement;
  effect(() => root.classList.toggle('tb-barre-ouverte', ouverte()));
  inject(DestroyRef).onDestroy(() => root.classList.remove('tb-barre-ouverte'));
}
