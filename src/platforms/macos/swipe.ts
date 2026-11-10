import { DOCUMENT, Location } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom, timeout } from 'rxjs';

import { PreferencesService } from '../../app/core/preferences';
import { TransitionsService } from '../../app/core/transitions';
import { MacHistory } from './history';

/** Where a horizontal scroll belongs to what is under the pointer, not to the page. */
const EXCLUDED = '.tb-chart-view, .tb-summary, .tb-reading-values, .tb-table, .tb-chips, .tb-segmented, input, textarea, select, .tb-stepper, .tb-dialog, .tb-scrim, .tb-rail, [data-no-gesture]';
/** Share of the way past which letting go goes on; or this speed (px per event), from 10 %. */
const THRESHOLD = 0.33;
const FLING = 14;
/** No wheel event for this long: the fingers (and the momentum after them) are done. */
const END = 160;

type Mode = 'morph' | 'follow';

interface Gesture {
  direction: 'back' | 'forward';
  mode: Mode;
  /** Distance travelled, in the direction of the gesture (px of the wheel). */
  dx: number;
  /** The last moves, for the speed when the fingers leave. */
  recent: number[];
  /** Morph: the page already asked for (the router is on its way). */
  asked: boolean;
  /** Morph: the animations of the card morph, paused, and how long each runs. */
  animations: { a: Animation; end: number }[] | null;
  /** Morph: the transition did not happen (nothing to morph into): the page just changed. */
  failed: boolean;
  /** Morph: a copy of the room page, to put back over the window if the gesture is undone. */
  shot: HTMLElement | null;
  main: HTMLElement | null;
  /** When the last wheel event came. */
  last: number;
  /** Morph: the fingers left before the transition was there: what they decided. */
  decision: boolean | null;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * The two-finger swipe of the trackpad in the macOS app: back (fingers to the right) and forward,
 * the page following the fingers and coming back where it was if they stop halfway.
 *
 * From a room back to « Maison » (where it was opened from), the room flows back into its card as
 * the fingers go: the card morph of TransitionsService, played backwards, paused and moved by the
 * fingers (its view transition starts as soon as the gesture does). Let go past a third of the
 * way, or fast, and it ends; else it goes back to the room, which the window shows again at once
 * (a copy of the page over it while the router goes forward again, without motion).
 *
 * Elsewhere, the page slides with the fingers and fades a little, then the other page makes its
 * entrance.
 *
 * WebKit's own swipe (allowsBackForwardNavigationGestures) slid a picture of the whole window,
 * toolbar and side bar with it: not used.
 */
@Injectable({ providedIn: 'root' })
export class MacSwipe {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly history = inject(MacHistory);
  private readonly transitions = inject(TransitionsService);
  private readonly prefs = inject(PreferencesService);
  private g: Gesture | null = null;
  /** After a gesture, the rest of its momentum is not a new one. */
  private quietUntil = 0;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });
  }

  private onWheel(e: WheelEvent): void {
    // Pinch (ctrl), a page zoomed: not a swipe
    if (e.ctrlKey) return;
    const g = this.g;
    if (!g) {
      if (e.timeStamp < this.quietUntil) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
        return;
      }
      if (Math.abs(e.deltaX) < 2 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;
      const direction = e.deltaX < 0 ? 'back' : 'forward';
      if (direction === 'back' ? !this.history.canGoBack() : !this.history.canGoForward()) return;
      if (!this.doc.querySelector('body.tb-app') || this.scrollsAcross(e.target, e.deltaX)) return;
      if (this.doc.body.style.overflow === 'hidden') return;
      this.begin(direction);
    }
    const current = this.g;
    if (!current) return;
    e.preventDefault();
    const step = current.direction === 'back' ? -e.deltaX : e.deltaX;
    current.dx = Math.max(0, current.dx + step);
    current.recent = [...current.recent.slice(-2), step];
    this.show(current);
    current.last = performance.now();
    this.wait(current);
  }

  /**
   * The end of the gesture: [END] without a wheel event. Not while its transition is still being
   * set up (the page changing holds the main thread: the events of the fingers wait behind it).
   */
  private wait(g: Gesture): void {
    clearTimeout(g.timer);
    g.timer = setTimeout(
      // After the events of the fingers that waited behind a busy frame (they come before it)
      () =>
        requestAnimationFrame(() => {
          if (this.g !== g) return;
          const starting = g.mode === 'morph' && g.asked && !g.animations && !g.failed;
          if (starting || performance.now() - g.last < END) this.wait(g);
          else this.release(g);
        }),
      END,
    );
  }

  /** Something under the pointer scrolls sideways that way (a table, a row of chips…). */
  private scrollsAcross(target: EventTarget | null, dx: number): boolean {
    let el = target instanceof Element ? target : null;
    if (el?.closest(EXCLUDED)) return true;
    for (; el && el !== this.doc.body; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const o = getComputedStyle(el).overflowX;
      if (o !== 'auto' && o !== 'scroll') continue;
      if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }
    return false;
  }

  private begin(direction: 'back' | 'forward'): void {
    const main = this.doc.querySelector<HTMLElement>('.tb-app .tb-main');
    const here = this.router.url;
    const morph =
      direction === 'back' &&
      !this.prefs.reducedMotion() &&
      'startViewTransition' in this.doc &&
      /^\/app\/room\//.test(here) &&
      /^\/app\/overview(\?|#|$)/.test(this.history.previous() ?? '');
    this.g = { direction, mode: morph ? 'morph' : 'follow', dx: 0, recent: [], asked: false, animations: null, failed: false, shot: null, main, decision: null, last: performance.now() };
    if (!morph && main) {
      main.style.transition = 'none';
      main.style.willChange = 'transform, opacity';
    }
  }

  private progress(g: Gesture): number {
    return Math.min(1, g.dx / Math.max(320, innerWidth * 0.45));
  }

  /** The page as far as the fingers went. */
  private show(g: Gesture): void {
    const p = this.progress(g);
    if (g.mode === 'follow') {
      if (!g.main) return;
      const sign = g.direction === 'back' ? 1 : -1;
      g.main.style.transform = `translateX(${sign * p * innerWidth * 0.35}px)`;
      g.main.style.opacity = String(1 - p * 0.45);
      return;
    }
    // The morph: asked once the fingers really go (a few pixels), then moved by them
    if (!g.asked && g.dx > 6) this.ask(g);
    for (const { a, end } of g.animations ?? []) a.currentTime = p * end;
  }

  /** Back to « Maison », the transition held at its start, then moved by the fingers. */
  private ask(g: Gesture): void {
    g.asked = true;
    g.shot = g.main ? copyOf(this.doc, g.main) : null;
    this.location.back();
    void (async () => {
      // The router starts the transition once the page is known: wait for it
      let t = this.transitions.ongoing();
      for (let i = 0; !t && i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        t = this.transitions.ongoing();
      }
      try {
        if (!t) throw new Error('no transition');
        await t.ready;
        // The photo flying back into the card starts one frame later (TransitionsService)
        await new Promise((r) => requestAnimationFrame(r));
        const animations = this.doc
          .getAnimations()
          .filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
          .map((a) => ({ a, end: Number(a.effect!.getComputedTiming().endTime) }));
        for (const { a } of animations) a.pause();
        g.animations = animations;
        if (this.g === g) {
          this.show(g);
        } else {
          // The fingers left before it was ready: what they decided
          this.settle(g, g.decision ?? true);
        }
      } catch {
        // Nothing to morph into: the page simply changed
        g.failed = true;
        g.shot?.remove();
        g.shot = null;
      }
    })();
  }

  /** The fingers are done: on to the other page, or back where it was. */
  private release(g: Gesture): void {
    if (this.g !== g) return;
    this.g = null;
    this.quietUntil = performance.now() + 250;
    const p = this.progress(g);
    const speed = g.recent.reduce((s, v) => s + v, 0) / Math.max(1, g.recent.length);
    const go = p >= THRESHOLD || (p > 0.1 && speed > FLING);
    if (g.mode === 'follow') {
      this.releaseFollow(g, go);
      return;
    }
    // The transition not there yet: settled once it is (ask)
    if (!g.asked || g.failed) {
      if (!g.asked) return;
      g.shot?.remove();
      return;
    }
    if (g.animations) this.settle(g, go);
    else g.decision = go;
  }

  /** The morph ends (the room in its card), or goes back to the room. */
  private settle(g: Gesture, go: boolean): void {
    const animations = g.animations ?? [];
    if (go) {
      for (const { a } of animations) a.play();
      g.shot?.remove();
      return;
    }
    // Back to the start of the morph, then the room page again, without motion
    const from = animations.map(({ a }) => Number(a.currentTime ?? 0));
    const t0 = performance.now();
    const duration = 180;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / duration);
      const ease = 1 - (1 - k) * (1 - k);
      animations.forEach(({ a }, i) => (a.currentTime = from[i] * (1 - ease)));
      if (k < 1) {
        requestAnimationFrame(tick);
        return;
      }
      void this.undo(g);
    };
    requestAnimationFrame(tick);
  }

  /** The room page shown again: its copy over the window while the router goes forward. */
  private async undo(g: Gesture): Promise<void> {
    const shot = g.shot;
    if (shot) {
      shot.style.visibility = 'visible';
      shot.style.zIndex = '2900';
    }
    this.transitions.quietNext();
    this.location.forward();
    try {
      await firstValueFrom(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), timeout(3000)));
      // Drawn: two frames
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    } catch {
      /* the page did not come back: the copy goes anyway */
    }
    shot?.remove();
  }

  private releaseFollow(g: Gesture, go: boolean): void {
    const main = g.main;
    if (!main) return;
    const sign = g.direction === 'back' ? 1 : -1;
    const reset = () => {
      main.style.removeProperty('transition');
      main.style.removeProperty('transform');
      main.style.removeProperty('opacity');
      main.style.removeProperty('will-change');
    };
    if (!go) {
      const a = main.animate(
        [{ transform: main.style.transform, opacity: main.style.opacity }, { transform: 'none', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.2, .9, .3, 1)' },
      );
      reset();
      a.finished.catch(() => undefined);
      return;
    }
    // On its way out, then the other page comes in (its entrance)
    const out = main.animate(
      [
        { transform: main.style.transform, opacity: main.style.opacity },
        { transform: `translateX(${sign * innerWidth * 0.4}px)`, opacity: 0 },
      ],
      { duration: 140, easing: 'ease-in', fill: 'forwards' },
    );
    void out.finished
      .catch(() => undefined)
      .then(() => {
        if (g.direction === 'back') this.location.back();
        else this.location.forward();
        void firstValueFrom(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), timeout(3000)))
          .catch(() => undefined)
          .then(() => {
            out.cancel();
            reset();
          });
      });
  }
}

/**
 * A still copy of the page [main] where it is on the screen (its curves drawn into the copies of
 * their canvases), hidden until needed.
 */
function copyOf(doc: Document, main: HTMLElement): HTMLElement {
  const r = main.getBoundingClientRect();
  const copy = main.cloneNode(true) as HTMLElement;
  const from = main.querySelectorAll('canvas');
  const to = copy.querySelectorAll('canvas');
  from.forEach((c, i) => {
    try {
      if (c.width && c.height) to[i]?.getContext('2d')?.drawImage(c, 0, 0);
    } catch {
      /* a canvas that can't be read: blank */
    }
  });
  copy.inert = true;
  Object.assign(copy.style, { position: 'absolute', left: '0', top: `${r.top}px`, width: `${r.width}px`, margin: '0', boxSizing: 'border-box' });
  // Over the content only: the side bar and the toolbar stay the window's (macos.css)
  const layer = doc.createElement('div');
  layer.className = 'tb-mac-shot';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.visibility = 'hidden';
  layer.style.left = `${Math.max(0, r.left)}px`;
  layer.append(copy);
  doc.body.append(layer);
  return layer;
}
