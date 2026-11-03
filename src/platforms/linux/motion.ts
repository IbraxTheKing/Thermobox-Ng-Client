import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';

import { DesktopService } from '../../app/core/desktop';
import { MotionStep, PageMotion } from '../../app/core/page-motion';
import { PreferencesService } from '../../app/core/preferences';
import { LinuxDesktopService } from './desktop.service';
import { LinuxSettings } from './settings';

/**
 * The Linux app moves as a GTK 4 app (AdwNavigationView), without view transitions (WebKitGTK
 * drew the card morph badly, half of it skipped; drawing with the processor, a view transition,
 * even skipped at once, crashed it: target.ts takes them away). A page opened from another one
 * (a room from the overview, Préférences…) slides in from the right over the page left, which
 * moves a little to the left under a shade; back, the page leaves to the right and uncovers the
 * one below. Pages of the sidebar replace each other with a short fade, as the panes of GNOME
 * apps. The page left is a copy of it (linuxShot), the page that comes the live one; no entrance
 * of the page part by part. Driven by TransitionsService (PAGE_MOTION): leave once the new page is
 * known, arrive once it is drawn.
 *
 * Two fingers to the right on the touchpad go back the same way, the page following the fingers
 * (onWheel, Préférences › Fenêtre › Balayer pour revenir).
 */
@Injectable()
export class LinuxMotion implements PageMotion {
  private readonly doc = inject(DOCUMENT);
  private readonly root = this.doc.documentElement;
  private readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);
  private readonly desktop = inject(DesktopService) as LinuxDesktopService;
  private readonly settings = inject(LinuxSettings);
  /** The push / pop running, to end at once if another page comes. */
  private gtkMotion: { animations: Animation[]; end: () => void } | null = null;
  /** A page change under way (between leave and arrive). */
  private pending = false;
  /** The swipe back under way (the page follows the fingers). */
  private swipe: Swipe | null = null;

  constructor() {
    addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });
  }

  /** No entrance: a GTK app shows its page at once (the motion is the push / pop). */
  entrance(): boolean {
    return true;
  }

  leave(fromPath: string, toPath: string, popstate: boolean, still: boolean): MotionStep {
    this.endMotion();
    const swipe = this.swipe;
    const depthFrom = linuxDepth(fromPath);
    const depthTo = linuxDepth(toPath);
    const kind: 'push' | 'pop' | 'switch' =
      depthTo > depthFrom
        ? 'push'
        : depthTo < depthFrom || (popstate && fromPath === toPath && fromPath !== '')
          ? 'pop'
          : 'switch';
    const main = this.doc.querySelector<HTMLElement>('.tb-app .tb-main');
    // The swipe has its copy already (or none: coming back to the page it showed)
    const quiet = still || !!swipe;
    const shot = !quiet && kind !== 'switch' && main ? linuxShot(this.doc, main) : null;
    this.pending = true;
    return {
      // The swipe leaves the page below where it was
      returnToCard: !swipe,
      arrive: (page) => {
        this.pending = false;
        if (swipe) {
          this.swipeLanded(swipe, page);
          return;
        }
        if (!page || !page.isConnected || quiet) {
          shot?.layer.remove();
          return;
        }
        if (shot && kind !== 'switch') this.slide(kind, shot, page);
        else this.gtkFade(page);
      },
      abort: (cancelled) => {
        this.pending = false;
        shot?.layer.remove();
        // A swipe that asked for the page behind: nothing behind, it comes back
        if (cancelled && this.swipe) this.swipeLanded(this.swipe, null);
      },
    };
  }

  /**
   * The push (the new page over the old one, from the right) or the pop (the old one leaves to
   * the right): the page above has its shadow on its left edge, the one below moves by a third
   * of the way, under a shade that fades.
   */
  private slide(kind: 'push' | 'pop', shot: Shot, page: HTMLElement): void {
    const doc = this.doc;
    const area = shot.area;
    const w = area.width;
    const timing: KeyframeAnimationOptions = {
      duration: 300,
      easing: 'cubic-bezier(.25, .46, .45, .94)',
      fill: 'both',
    };
    const box = (cls: string, z: number) => layerBox(doc, cls, z, area);
    this.root.classList.add('tb-lx-nav');
    const out = `translateX(${-w * 0.3}px)`;
    const animations: Animation[] = [];
    const extra: HTMLElement[] = [];
    // The live page stacked above or under the copy, as needed, while it moves
    page.style.position = 'relative';
    if (kind === 'push') {
      shot.layer.style.zIndex = '5';
      const dim = box('tb-lx-dim', 5);
      const sheet = box('tb-lx-sheet', 6);
      page.style.zIndex = '7';
      extra.push(dim, sheet);
      animations.push(
        shot.layer.animate({ transform: ['none', out] }, timing),
        dim.animate({ opacity: [0, 1] }, timing),
        sheet.animate({ transform: [`translateX(${w}px)`, 'none'] }, timing),
        page.animate({ transform: [`translateX(${w}px)`, 'none'] }, timing),
      );
    } else {
      page.style.zIndex = '5';
      const dim = box('tb-lx-dim', 6);
      shot.layer.style.zIndex = '7';
      shot.layer.classList.add('tb-lx-above');
      extra.push(dim);
      animations.push(
        page.animate({ transform: [out, 'none'] }, timing),
        dim.animate({ opacity: [1, 0] }, timing),
        shot.layer.animate({ transform: ['none', `translateX(${w}px)`] }, timing),
      );
    }
    const end = () => {
      if (this.gtkMotion?.end !== end) return;
      this.gtkMotion = null;
      for (const a of animations) a.cancel();
      shot.layer.remove();
      for (const e of extra) e.remove();
      page.style.removeProperty('position');
      page.style.removeProperty('z-index');
      this.root.classList.remove('tb-lx-nav');
    };
    this.gtkMotion = { animations, end };
    Promise.all(animations.map((a) => a.finished)).then(end, end);
  }

  /** Linux, between the pages of the sidebar: the new one appears quickly, as a GNOME pane. */
  private gtkFade(page: HTMLElement): void {
    const a = page.animate({ opacity: [0, 1] }, { duration: 150, easing: 'ease-out' });
    const end = () => {
      if (this.gtkMotion?.end !== end) return;
      this.gtkMotion = null;
      a.cancel();
    };
    this.gtkMotion = { animations: [a], end };
    a.finished.then(end, end);
  }

  private endMotion(): void {
    this.gtkMotion?.end();
  }

  // ---------------------------------------------------------------- Linux: swipe back

  /** The wheel events of the gesture going on: their direction, what they add up to. */
  private wheelAxis: 'x' | 'y' | null = null;
  private wheelSum = { x: 0, y: 0 };
  private wheelAt = 0;

  /**
   * Linux: two fingers to the right on the touchpad (to the left if it does not scroll
   * « naturally »), on a page opened from another one: the page follows the fingers and uncovers
   * the one below, as in AdwNavigationView. Let go past the middle, or flung: back; else it comes
   * back. The page below is the real one: the app goes back as the gesture starts (under the copy
   * of the page left), and forward again if the gesture is given up.
   */
  private onWheel(e: WheelEvent): void {
    const s = this.swipe;
    const gap = e.timeStamp - this.wheelAt;
    this.wheelAt = e.timeStamp;
    if (s) {
      // The page follows; once let go, what the fingers still send does nothing
      e.preventDefault();
      if (s.state === 'follow') this.swipeMove(s, e);
      return;
    }
    if (gap > 180) {
      this.wheelAxis = null;
      this.wheelSum = { x: 0, y: 0 };
    }
    if (this.wheelAxis === 'y' || e.ctrlKey || e.deltaMode !== 0 || !this.settings.swipeBack()) return;
    this.wheelSum.x += e.deltaX;
    this.wheelSum.y += e.deltaY;
    if (this.wheelAxis === null) {
      if (Math.hypot(this.wheelSum.x, this.wheelSum.y) < 8) return;
      this.wheelAxis = Math.abs(this.wheelSum.x) > Math.abs(this.wheelSum.y) * 1.2 ? 'x' : 'y';
      if (this.wheelAxis === 'y') return;
    }
    const back = this.desktop.naturalScroll() ? -this.wheelSum.x : this.wheelSum.x;
    if (back <= 0 || !this.canSwipeBack(e.target)) {
      // Forward, or nothing to go back to: the gesture is left to the page
      this.wheelAxis = 'y';
      return;
    }
    e.preventDefault();
    this.swipeStart(back);
  }

  /** A page opened from another one, that one in the history, nothing over the page. */
  private canSwipeBack(target: EventTarget | null): boolean {
    if (this.swipe || this.pending || this.gtkMotion) return false;
    if (linuxDepth(path(this.router.routerState.snapshot.root)) === 0) return false;
    if (((history.state as { navigationId?: number } | null)?.navigationId ?? 1) <= 1) return false;
    if (
      this.doc.querySelector('.tb-scrim, .tb-adw-scrim') ||
      this.doc.body.style.overflow === 'hidden'
    )
      return false;
    // Something that scrolls sideways under the fingers, and can go that way: it scrolls
    for (
      let el = target instanceof Element ? target : null;
      el && el !== this.doc.body;
      el = el.parentElement
    ) {
      const o = getComputedStyle(el).overflowX;
      if (
        (o === 'auto' || o === 'scroll') &&
        el.scrollWidth > el.clientWidth + 1 &&
        el.scrollLeft > 0
      )
        return false;
    }
    return !!this.doc.querySelector('.tb-app .tb-main');
  }

  private swipeStart(initial: number): void {
    const main = this.doc.querySelector<HTMLElement>('.tb-app .tb-main');
    if (!main) return;
    const shot = linuxShot(this.doc, main);
    shot.layer.style.zIndex = '7';
    shot.layer.classList.add('tb-lx-above');
    const dim = layerBox(this.doc, 'tb-lx-dim', 6, shot.area);
    this.root.classList.add('tb-lx-nav');
    const s: Swipe = {
      shot,
      dim,
      w: Math.max(1, shot.area.width),
      progress: 0,
      page: null,
      state: 'follow',
      goal: 'back',
      samples: [],
      landed: false,
      settled: false,
      timer: undefined,
      safety: setTimeout(() => this.swipeCleanup(s), 4000),
    };
    this.swipe = s;
    this.swipeAdd(s, initial, performance.now());
    // The page below: the one before in the history (linuxStart sees the swipe: no motion of
    // its own; newPage gives it to swipeLanded)
    history.back();
  }

  private swipeMove(s: Swipe, e: WheelEvent): void {
    // The end of the scroll (fingers lifted): a last event without a move
    if (e.deltaX === 0 && e.deltaY === 0) {
      this.swipeRelease(s);
      return;
    }
    this.swipeAdd(s, this.desktop.naturalScroll() ? -e.deltaX : e.deltaX, e.timeStamp);
  }

  private swipeAdd(s: Swipe, d: number, t: number): void {
    s.progress = Math.min(1, Math.max(0, s.progress + d / s.w));
    s.samples.push({ t, d });
    while (s.samples.length && t - s.samples[0].t > 100) s.samples.shift();
    this.swipeApply(s);
    clearTimeout(s.timer);
    // No event for a moment: the fingers are lifted
    s.timer = setTimeout(() => this.swipeRelease(s), 140);
  }

  /** The page left at [progress] of the way, the page below coming out from under its shade. */
  private swipeApply(s: Swipe): void {
    const p = s.progress;
    s.shot.layer.style.transform = `translateX(${p * s.w}px)`;
    s.dim.style.opacity = String(1 - p);
    if (s.page) s.page.style.transform = p >= 1 ? '' : `translateX(${-0.3 * s.w * (1 - p)}px)`;
  }

  /** Let go: back if past the middle or flung that way, else back where it was. */
  private swipeRelease(s: Swipe, force?: 'stay'): void {
    if (s.state !== 'follow') return;
    clearTimeout(s.timer);
    // What the fingers still send (inertia) belongs to this gesture
    this.wheelAxis = 'y';
    // The speed of the last moves (px/ms): a fling goes back from anywhere, a fling the other way
    // comes back from anywhere
    const n = s.samples.length;
    const v =
      n > 1
        ? s.samples.slice(1).reduce((a, x) => a + x.d, 0) /
          Math.max(16, s.samples[n - 1].t - s.samples[0].t)
        : 0;
    s.goal =
      force ?? (s.progress > 0 && (v > 0.6 || (s.progress > 0.5 && v > -0.3)) ? 'back' : 'stay');
    s.state = 'settle';
    const from = s.progress;
    const to = s.goal === 'back' ? 1 : 0;
    const duration = this.prefs.reducedMotion()
      ? 0
      : Math.min(300, Math.max(120, Math.abs(to - from) * 400));
    const start = performance.now();
    // The rest of the way, eased out (each frame also places the page below once it is there)
    const step = (now: number) => {
      if (this.swipe !== s) return;
      const k = duration ? Math.min(1, (now - start) / duration) : 1;
      s.progress = from + (to - from) * (1 - Math.pow(1 - k, 3));
      this.swipeApply(s);
      if (k < 1) requestAnimationFrame(step);
      else {
        s.settled = true;
        this.swipeSettled(s);
      }
    };
    requestAnimationFrame(step);
  }

  /** The app is back on the page below ([page]), or could not go back (null). */
  private swipeLanded(s: Swipe, page: HTMLElement | null): void {
    if (this.swipe !== s) return;
    if (s.state === 'return') {
      this.swipeCleanup(s);
      return;
    }
    s.landed = true;
    if (page) {
      s.page = page;
      page.style.position = 'relative';
      page.style.zIndex = '5';
      this.swipeApply(s);
    } else if (s.state === 'follow') {
      // Nothing behind: it comes back
      this.swipeRelease(s, 'stay');
    }
    this.swipeSettled(s);
  }

  /** Both done (the motion, the page below): back for good, or forward again. */
  private swipeSettled(s: Swipe): void {
    if (!s.settled || !s.landed || s.state !== 'settle') return;
    if (s.goal === 'stay' && s.page) {
      // The page left comes back for real, under its copy
      s.state = 'return';
      history.forward();
      return;
    }
    this.swipeCleanup(s);
  }

  private swipeCleanup(s: Swipe): void {
    if (this.swipe !== s) return;
    this.swipe = null;
    clearTimeout(s.timer);
    clearTimeout(s.safety);
    s.shot.layer.remove();
    s.dim.remove();
    if (s.page) {
      s.page.style.removeProperty('position');
      s.page.style.removeProperty('z-index');
      s.page.style.removeProperty('transform');
    }
    this.root.classList.remove('tb-lx-nav');
  }
}

function sheet(s: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let r = s;
  while (r.firstChild) r = r.firstChild;
  return r;
}

/** Path of the deepest route ("overview", "room/:id"…). */
function path(s: ActivatedRouteSnapshot): string {
  return sheet(s).routeConfig?.path ?? '';
}

/**
 * Linux: how deep a page is in the navigation of the app. The pages of the sidebar are at the top;
 * a room, Préférences, the profile, À propos… are opened from them (a back button in the header
 * bar), as the subpages of an AdwNavigationView.
 */
function linuxDepth(path: string): number {
  return ['room/:id', 'preferences', 'profile', 'about', 'more'].includes(path) ? 1 : 0;
}

/** The swipe back under way (swipeStart). */
interface Swipe {
  shot: Shot;
  dim: HTMLElement;
  /** The width of the place of the pages. */
  w: number;
  /** 0: the page left where it was; 1: gone to the right. */
  progress: number;
  /** The page below, once the app is back on it. */
  page: HTMLElement | null;
  /** Following the fingers; going the rest of the way; coming back to the page left. */
  state: 'follow' | 'settle' | 'return';
  goal: 'back' | 'stay';
  /** The last moves (100 ms), for the speed of the fling. */
  samples: { t: number; d: number }[];
  landed: boolean;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Whatever happens, the copy goes after a while. */
  safety: ReturnType<typeof setTimeout>;
}

/** A layer over the place of the pages (the shade, the sheet). */
function layerBox(doc: Document, cls: string, z: number, area: Shot['area']): HTMLElement {
  const e = doc.createElement('div');
  e.className = cls;
  e.setAttribute('aria-hidden', 'true');
  Object.assign(e.style, {
    left: `${area.left}px`,
    top: `${area.top}px`,
    width: `${area.width}px`,
    height: `${area.height}px`,
    zIndex: String(z),
  });
  doc.body.append(e);
  return e;
}

interface Shot {
  /** The copy of the page left, in a layer the size of the place of the pages. */
  layer: HTMLElement;
  /** That place, on the screen: under the header bar, beside the sidebar. */
  area: { left: number; top: number; width: number; height: number };
}

/**
 * Linux: a copy of the page shown, where it is on the screen, before the router replaces it. The
 * canvases (charts) are copied as pictures, the copy can't be focused nor clicked.
 */
function linuxShot(doc: Document, main: HTMLElement): Shot {
  const style = getComputedStyle(main);
  const left = parseFloat(style.getPropertyValue('--tb-rail')) || 0;
  const top = parseFloat(style.getPropertyValue('--tb-chrome-top')) || 0;
  const area = {
    left,
    top,
    width: Math.max(0, innerWidth - left),
    height: Math.max(0, innerHeight - top),
  };
  const r = main.getBoundingClientRect();
  const copy = main.cloneNode(true) as HTMLElement;
  const from = main.querySelectorAll('canvas');
  const to = copy.querySelectorAll('canvas');
  from.forEach((c, i) => {
    try {
      if (c.width && c.height) to[i]?.getContext('2d')?.drawImage(c, 0, 0);
    } catch {
      // A canvas that can't be read: left blank
    }
  });
  copy.inert = true;
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${r.left - left}px`,
    top: `${r.top - top}px`,
    width: `${r.width}px`,
    margin: '0',
    boxSizing: 'border-box',
  });
  const layer = doc.createElement('div');
  layer.className = 'tb-lx-shot';
  // Its colour too: the tint of its page (a room), if it has one
  const tint = doc.querySelector<HTMLElement>('.tb-background-page');
  const color =
    tint && getComputedStyle(tint).display !== 'none' ? getComputedStyle(tint).backgroundColor : '';
  if (color && !/^rgba\(.*,\s*0\)$|^transparent$/.test(color))
    layer.style.background = `linear-gradient(${color}, ${color}), var(--lx-window)`;
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    left: `${area.left}px`,
    top: `${area.top}px`,
    width: `${area.width}px`,
    height: `${area.height}px`,
  });
  layer.append(copy);
  doc.body.append(layer);
  return { layer, area };
}
