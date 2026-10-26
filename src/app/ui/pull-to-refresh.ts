import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject } from '@angular/core';

import { PlatformService } from '../core/platform';
import { PreferencesService } from '../core/preferences';

/** Pull (px, after resistance) past which letting go refreshes. */
const THRESHOLD = 72;
/** Furthest the indicator goes down. */
const MAXIMUM = 120;
/** Finger travel → indicator travel. */
const RESISTANCE = 0.5;

/**
 * Pull to refresh (phones): at the top of the page, pull it down and let go to read it again, as
 * in native apps. A round indicator comes down from under the top bar, its arrow turning with the
 * pull; past the threshold it fills, a tap of the phone; let go, it spins until the page is read.
 * The browser's own gesture (Chrome reloads the whole app) is turned off meanwhile.
 *
 *   readonly pull = inject(PullToRefresh).activate(() => this.refresh());   // in a page
 *   @if (!tirer()) { <button …>Actualiser</button> }
 */
@Injectable({ providedIn: 'root' })
export class PullToRefresh {
  private readonly doc = inject(DOCUMENT);
  private readonly platform = inject(PlatformService);
  private readonly prefs = inject(PreferencesService);

  /**
   * For the page being built (call from its constructor). Returns whether the gesture is there
   * (a phone held upright, with touch): the page then hides its « Actualiser » button.
   */
  activate(refresh: () => Promise<unknown>): () => boolean {
    const touch = 'ontouchstart' in window;
    const active = computed(() => touch && this.platform.bottomBar());

    const root = this.doc.documentElement;
    const indicator = this.doc.createElement('div');
    indicator.className = 'tb-pull';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<span class="tb-pull-round"><i class="pi pi-arrow-down"></i></span>';
    this.doc.body.appendChild(indicator);
    root.classList.add('tb-pull-page');

    let g: { y0: number; x0: number; pulled: number; mode: '?' | 'v' | 'non'; passed: boolean } | null = null;
    let inProgress = false;

    const set = (pulled: number, transition: boolean) => {
      indicator.style.transition = transition ? 'transform .3s cubic-bezier(.2, 0, 0, 1), opacity .3s ease' : 'none';
      indicator.style.transform = `translate(-50%, ${pulled - 56}px)`;
      indicator.style.opacity = pulled > 4 ? '1' : '0';
      indicator.style.setProperty('--tb-pull-p', String(Math.min(1, pulled / THRESHOLD)));
    };

    const start = (e: TouchEvent) => {
      g = null;
      if (!active() || inProgress || e.touches.length !== 1 || scrollY > 0) return;
      // Not from inside something that scrolls or opens (sheet, chart, list…)
      if ((e.target as Element | null)?.closest?.('.tb-dialog, .tb-scrim, .tb-chart-view, input, textarea, select, [data-no-gesture]')) return;
      const t = e.touches[0];
      g = { y0: t.clientY, x0: t.clientX, pulled: 0, mode: '?', passed: false };
    };

    const move = (e: TouchEvent) => {
      if (!g || g.mode === 'non') return;
      const t = e.touches[0];
      const dy = t.clientY - g.y0;
      const dx = t.clientX - g.x0;
      if (g.mode === '?') {
        if (Math.hypot(dx, dy) < 8) return;
        // Down and from the very top: the gesture; anything else is the page's
        g.mode = dy > 0 && Math.abs(dy) > Math.abs(dx) && scrollY <= 0 ? 'v' : 'non';
        if (g.mode === 'non') return;
        indicator.classList.add('tb-pull-on');
      }
      e.preventDefault();
      g.pulled = Math.min(MAXIMUM, Math.max(0, dy * RESISTANCE));
      set(g.pulled, false);
      const passed = g.pulled >= THRESHOLD;
      if (passed !== g.passed) {
        g.passed = passed;
        indicator.classList.toggle('tb-pull-ready', passed);
        if (passed) this.platform.vibrate();
      }
    };

    const end = () => {
      const gesture = g;
      g = null;
      if (!gesture || gesture.mode !== 'v') return;
      if (!gesture.passed) {
        retract();
        return;
      }
      inProgress = true;
      indicator.classList.add('tb-pull-load');
      set(THRESHOLD * 0.8, this.prefs.animate());
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          inProgress = false;
          retract();
        });
    };

    const retract = () => {
      set(0, this.prefs.animate());
      indicator.classList.remove('tb-pull-ready', 'tb-pull-load');
      setTimeout(() => indicator.classList.remove('tb-pull-on'), 300);
    };

    set(0, false);
    this.doc.addEventListener('touchstart', start, { passive: true });
    this.doc.addEventListener('touchmove', move, { passive: false });
    this.doc.addEventListener('touchend', end, { passive: true });
    this.doc.addEventListener('touchcancel', end, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('touchstart', start);
      this.doc.removeEventListener('touchmove', move);
      this.doc.removeEventListener('touchend', end);
      this.doc.removeEventListener('touchcancel', end);
      indicator.remove();
      root.classList.remove('tb-pull-page');
    });
    return active;
  }
}
