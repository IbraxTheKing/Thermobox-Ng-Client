import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject } from '@angular/core';

/**
 * The bar of the ticked rows (.tb-bar) is shown: html.tb-bar-open, for the room left under
 * the page and the floating button that steps aside. A class rather than :has(.tb-bar-on) on
 * the page: such a selector made the browser check the whole page again at every change of a
 * class anywhere in it (each animation, each row), which phones felt. Call in a constructor.
 *
 * The bar is fixed to the window but centred on the column of the page (.tb-main): its edges
 * are measured (--tb-bar-left / --tb-bar-right), whatever the width of the side bar, folded or
 * not, and of the window.
 */
export function followSelectionBar(open: () => boolean): void {
  const doc = inject(DOCUMENT);
  const root = doc.documentElement;
  let observer: ResizeObserver | null = null;

  const measure = () => {
    const main = doc.querySelector<HTMLElement>('.tb-main');
    if (!main) return;
    const r = main.getBoundingClientRect();
    const cs = getComputedStyle(main);
    root.style.setProperty('--tb-bar-left', `${Math.round(r.left + parseFloat(cs.paddingLeft))}px`);
    root.style.setProperty('--tb-bar-right', `${Math.round(doc.documentElement.clientWidth - r.right + parseFloat(cs.paddingRight))}px`);
  };

  effect(() => {
    const on = open();
    root.classList.toggle('tb-bar-open', on);
    if (on && !observer && typeof ResizeObserver !== 'undefined') {
      measure();
      observer = new ResizeObserver(measure);
      const main = doc.querySelector<HTMLElement>('.tb-main');
      if (main) observer.observe(main);
      observer.observe(root);
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
    }
  });
  inject(DestroyRef).onDestroy(() => {
    root.classList.remove('tb-bar-open');
    observer?.disconnect();
  });
}
