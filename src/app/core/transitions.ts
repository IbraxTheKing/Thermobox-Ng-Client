import { DOCUMENT } from '@angular/common';
import { EnvironmentInjector, Injectable, afterNextRender, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  ResolveEnd,
  Router,
  ViewTransitionInfo,
} from '@angular/router';

import { DesktopService } from './desktop';
import { PlatformService } from './platform';
import { PreferencesService } from './preferences';
import { DESKTOP_OS } from './tauri';

/** State whose colour the page takes (« Couleurs selon l'état »). */
export type Tone = 'stable' | 'heating' | 'hot' | 'unknown';

type Doc = Document & { startViewTransition?: (f: () => void | Promise<void>) => ViewTransition };

/**
 * Motion between pages, as tbAnim of the JSF interface, for a single-page app:
 *
 * - every page change goes through a view transition (cross-fade, the dashboard card morphing into
 *   the room page), and the new page makes its entrance (html.tb-entering, 1.6 s: the head rises,
 *   the cards follow one after the other, their curves draw themselves);
 * - dashboard ↔ room: only the card moves (html.tb-card-morph), nothing else pops in. On phones
 *   (html.tb-card-full) the card opens into the whole room page and the page closes back into
 *   it (Material container transform): card and page are the same width there, a card morphing
 *   into the card of the page did not show. Only that card
 *   and its room page carry view-transition names (data-vt), and only during the transition: a
 *   name on every card made each of them a group of its own, every page change blurred and faded
 *   the whole dashboard piece by piece;
 * - other page changes: no picture of the pages at all (the new page is there at once and makes
 *   its entrance, live; pictures of glass came out blurred);
 * - the colour of the page (state of the room shown, dashboard filter) changes through a
 *   cross-fade of two pictures of the page, done by the compositor, instead of animating the
 *   colours of every element on every frame (which made phones stutter and went through other
 *   hues on the way). A change during a page transition joins it; after it, waits for its end.
 *
 * The Windows app moves as a WinUI 3 app instead (windows.css): the new page comes in as one
 * block, as a Frame (html.tb-win-entering: it rises a little and fades in, a third of a second),
 * its parts don't come one after the other.
 *
 * The Linux app moves as a GTK 4 app (AdwNavigationView), without view transitions (WebKitGTK
 * drew the card morph badly, half of it skipped; drawing with the processor, a view transition,
 * even skipped at once, crashed it: desktop.ts takes them away): a page opened from another one
 * (a room from the overview, Préférences…) slides in from the right over the page left, which
 * moves a little to the left under a shade; back, the page leaves to the right and uncovers the
 * one below. Pages of the sidebar replace each other with a short fade, as the panes of GNOME
 * apps. The page left is a copy of it (linuxShot), the page that comes the live one. Driven by
 * the events of the router: the copy once the new page is known (ResolveEnd), the motion once it
 * is drawn. Two fingers to the right on the touchpad go back the same way, the page following
 * the fingers (swipeBack).
 *
 * Nothing moves when the system asks for less motion.
 *
 * Scroll of the pages (instead of the router's, withInMemoryScrolling off): back on a page, it
 * is where it was left, a new page starts at the top. Done in the update of the page transition,
 * before the picture of the new page is taken: the router did it a frame later, after the
 * picture, so the card coming back morphed to where the page had been, then the page jumped (and
 * coming back from a room it undid returnToCard). A page still growing (its data not there yet)
 * is scrolled again as it grows, until the user scrolls it.
 */
@Injectable({ providedIn: 'root' })
export class TransitionsService {
  private readonly doc = inject(DOCUMENT) as Doc;
  private readonly prefs = inject(PreferencesService);
  private readonly platform = inject(PlatformService);
  private readonly root = this.doc.documentElement;
  private readonly gtk = DESKTOP_OS === 'linux';
  /** Linux: the push / pop running, to end at once if another page comes. */
  private gtkMotion: { animations: Animation[]; end: () => void } | null = null;
  /** Linux: a page change under way (between ResolveEnd and the new page drawn). */
  private linuxNav = false;
  /** Linux: the copy of the page left, until the new page is drawn. */
  private linuxPending: {
    shot: Shot | null;
    kind: 'push' | 'pop' | 'switch';
    from: string;
    to: string;
    id: string;
  } | null = null;
  /** Linux: the swipe back under way (the page follows the fingers). */
  private swipe: Swipe | null = null;

  private current: ViewTransition | null = null;
  /**
   * Safari and every browser of iOS: pictures of the glass (backdrop-filter) come out blurred.
   * The colour of the page then changes without pictures: the background glides to the new
   * colour (tokens.css, body::before), the rest of the palette follows at once.
   */
  private readonly webkit =
    /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\//.test(navigator.userAgent);
  /** The new page is not in place yet: a colour asked now goes with it. */
  private beforeUpdate = false;
  private timer?: ReturnType<typeof setTimeout>;

  private shownTone: Tone | null = null;
  private wantedTone: Tone | null = null;
  private tonePending = false;

  /** Card clicked on the dashboard, and where it was on the screen (to come back to it). */
  private clickedCard: { id: string; el: HTMLElement; top: number } | null = null;
  private named: HTMLElement[] = [];

  /**
   * The browser has already shown the way back itself (swipe from the edge in Safari, back
   * gesture of Android): no second animation on top of it.
   */
  private byBrowser = false;
  /** What to do on the new page before its picture is taken (names, colour, scroll…). */
  private onNewPage: (() => void) | null = null;
  private pending: (() => void)[] = [];

  private readonly router = inject(Router);
  private readonly injector = inject(EnvironmentInjector);
  private readonly desktop = inject(DesktopService);
  /** Where each page of the history was left, by navigation id (as the router kept them). */
  private readonly positions = new Map<number, number>();
  private shownId = 0;
  private restoredId = 0;
  private popstate = false;
  /** Where the page that comes goes: its old place (back), or the top. */
  private scrollTarget: number | null = null;
  private stopGrowing: (() => void) | null = null;

  constructor() {
    history.scrollRestoration = 'manual';
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.positions.set(this.shownId, scrollY);
        this.popstate = e.navigationTrigger === 'popstate';
        this.restoredId = e.restoredState?.navigationId ?? 0;
      } else if (e instanceof ResolveEnd && this.gtk) {
        this.linuxStart(
          path(this.router.routerState.snapshot.root),
          path(e.state.root),
          String(
            sheet(
              path(e.state.root) === 'room/:id'
                ? e.state.root
                : this.router.routerState.snapshot.root,
            ).params['id'] ?? '',
          ),
        );
      } else if (e instanceof NavigationEnd) {
        this.shownId = e.id;
        this.scrollTarget = this.popstate ? (this.positions.get(this.restoredId) ?? 0) : 0;
        // Linux: the motion once the new page is drawn
        if (this.gtk && this.linuxNav)
          afterNextRender(() => this.newPage(), { injector: this.injector });
        // With a page transition: in its update (newPage); without (browser without them): once
        // the new page is drawn
        else if (!this.beforeUpdate)
          afterNextRender(() => this.restoreScroll(), { injector: this.injector });
      } else if (
        this.gtk &&
        (e instanceof NavigationCancel ||
          e instanceof NavigationError ||
          e instanceof NavigationSkipped)
      ) {
        this.linuxAbort();
      }
    });
    // The picture of the new page is taken as soon as the update callback is done: what must be
    // in it (names of what morphs, colour, page put straight) is done at the end of that
    // callback, not after updateCallbackDone (too late: the picture is already taken)
    const start = this.doc.startViewTransition?.bind(this.doc);
    if (start) {
      this.doc.startViewTransition = (update?: () => void | Promise<void>) =>
        start(async () => {
          try {
            await update?.();
          } finally {
            this.newPage();
          }
        });
    }
    addEventListener(
      'popstate',
      (e) =>
        (this.byBrowser =
          (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ===
          true),
      true,
    );
    // Linux: two fingers on the touchpad go back (swipeBack)
    if (this.gtk)
      addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });
    this.doc.addEventListener(
      'click',
      (e) => {
        const card = (e.target as Element | null)?.closest?.('.tb-room') as HTMLElement | null;
        if (!card || !(e.target as Element).closest('.tb-stretched')) return;
        this.clickedCard = {
          id: card.dataset['vtId'] ?? '',
          el: card,
          top: card.getBoundingClientRect().top,
        };
      },
      true,
    );
  }

  /** Called by the router for each page change (app.config.ts). */
  onTransition({ transition, from, to }: ViewTransitionInfo): void {
    const byBrowser = this.byBrowser;
    this.byBrowser = false;
    if (this.prefs.reducedMotion() || byBrowser) {
      transition.skipTransition();
      return;
    }
    const fromPath = path(from);
    const toPath = path(to);
    const card = isCard(fromPath, toPath);
    const id = card ? String(sheet(toPath === 'room/:id' ? to : from).params['id'] ?? '') : '';
    // Between pages: no pictures of the pages. A picture of the glass (backdrop-filter) is drawn
    // without its blur or blurred as a whole depending on the browser, and every card of the
    // dashboard showed blurred, then popped back. The new page is there at once, live, and makes
    // its entrance. Only the dashboard card morphing into its room page needs pictures.
    if (!card) transition.skipTransition();
    this.current = transition;
    this.beforeUpdate = true;
    this.root.classList.toggle('tb-card-morph', card);
    this.root.classList.toggle('tb-card-full', card && this.platform.bottomBar());
    // A real transition: what morphs must not also slide in (jsf.css, .tb-vt-in)
    this.root.classList.toggle('tb-vt-in', card);
    // The card (or the room page) we leave: its picture is taken on the next frame
    if (card) this.name(id, fromPath === 'overview');
    // The photo flies out of the card (and back into it): where it starts, measured on the page
    // we leave, before it changes
    const forward = toPath === 'room/:id';
    const cardStart =
      card && forward && this.clickedCard?.id === id && this.clickedCard.el.isConnected
        ? frame(this.clickedCard.el)
        : null;
    const photoStart = card && !forward ? this.namedPhoto(id) : null;
    const backStart = photoStart ? frame(photoStart) : null;
    this.onNewPage = () => {
      // The page we arrive on, before its picture is taken
      if (card) {
        this.unname();
        if (toPath === 'overview') this.returnToCard(id);
        this.name(id, false);
        // Nothing to morph into (room page not ready, card in a folded section): the card
        // would stay on its own in the middle of the new page, so no transition at all
        if (
          !this.named.some(
            (e) => e.style.getPropertyValue('view-transition-name') === `room-card-${id}`,
          )
        ) {
          this.unname();
          transition.skipTransition();
        }
      }
      // Part of the new picture: no second cross-fade
      this.applyTone(this.wantedTone);
      if (!card) this.entrance();
    };
    // Not through the wrapped startViewTransition (created before this service): late, but done
    transition.updateCallbackDone.catch(() => undefined).then(() => this.newPage());
    if (card && (cardStart || backStart)) {
      transition.ready.then(() => this.flyPhoto(id, cardStart, backStart)).catch(() => undefined);
    }
    transition.finished
      .catch(() => undefined)
      .then(() => {
        this.unname();
        if (this.current !== transition) return;
        this.current = null;
        this.root.classList.remove('tb-vt-in', 'tb-card-morph', 'tb-card-full', 'tb-vt-flight');
        if (this.tonePending) this.fade();
      });
  }

  /**
   * Linux: AdwNavigationView. The new page is known (ResolveEnd), the old one still shown: it is
   * copied before it goes; the new one is animated live once drawn (newPage).
   */
  private linuxStart(fromPath: string, toPath: string, id: string): void {
    this.endLinuxMotion();
    const swipe = this.swipe;
    const byBrowser = this.byBrowser;
    this.byBrowser = false;
    const depthFrom = linuxDepth(fromPath);
    const depthTo = linuxDepth(toPath);
    const kind: 'push' | 'pop' | 'switch' =
      depthTo > depthFrom
        ? 'push'
        : depthTo < depthFrom || (this.popstate && fromPath === toPath && fromPath !== '')
          ? 'pop'
          : 'switch';
    const main = this.doc.querySelector<HTMLElement>('.tb-app .tb-main');
    // The swipe has its copy already (or none: coming back to the page it showed)
    const still = this.prefs.reducedMotion() || byBrowser || !!swipe;
    const shot = !still && kind !== 'switch' && main ? linuxShot(this.doc, main) : null;
    this.linuxPending?.shot?.layer.remove();
    this.linuxPending = { shot, kind, from: fromPath, to: toPath, id };
    this.linuxNav = true;
    this.beforeUpdate = true;
    this.onNewPage = () => {
      const p = this.linuxPending;
      this.linuxPending = null;
      this.linuxNav = false;
      if (p?.from === 'room/:id' && p.to === 'overview' && p.id && !swipe) this.returnToCard(p.id);
      this.applyTone(this.wantedTone);
      const page = this.doc.querySelector<HTMLElement>('.tb-app .tb-main');
      if (swipe) {
        this.swipeLanded(swipe, page);
        return;
      }
      if (!p || !page || !page.isConnected || still) {
        p?.shot?.layer.remove();
        return;
      }
      if (p.shot && p.kind !== 'switch') this.slide(p.kind, p.shot, page);
      else this.gtkFade(page);
    };
  }

  /** Linux: the page change did not happen (a guard said no, an error): its copy goes. */
  private linuxAbort(): void {
    if (!this.linuxNav) return;
    this.linuxPending?.shot?.layer.remove();
    this.linuxPending = null;
    this.linuxNav = false;
    this.beforeUpdate = false;
    this.onNewPage = null;
    // A swipe that asked for the page behind: nothing behind, it comes back
    if (this.swipe) this.swipeLanded(this.swipe, null);
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

  private endLinuxMotion(): void {
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
    if (this.wheelAxis === 'y' || e.ctrlKey || e.deltaMode !== 0 || !this.prefs.swipeBack()) return;
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
    if (this.swipe || this.linuxNav || this.gtkMotion) return false;
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

  /**
   * [fn] once the new page is in place: right away, or, during a page transition, between the
   * picture of the page left and the picture of the new one.
   */
  afterUpdate(fn: () => void): void {
    if ((this.current || this.linuxNav) && this.beforeUpdate) this.pending.push(fn);
    else fn();
  }

  /** End of the update of a page transition: the new page is there, its picture not taken yet. */
  private newPage(): void {
    if (!this.beforeUpdate) return;
    this.beforeUpdate = false;
    const f = this.onNewPage;
    this.onNewPage = null;
    this.restoreScroll();
    f?.();
    for (const fn of this.pending.splice(0)) fn();
  }

  /** The page where it was left (back), or at the top; again as it grows, if it must. */
  private restoreScroll(): void {
    const top = this.scrollTarget;
    this.scrollTarget = null;
    this.stopGrowing?.();
    if (top == null) return;
    scrollTo({ top, behavior: 'instant' });
    if (top <= 0 || Math.abs(scrollY - top) < 1) return;
    // Not tall enough yet: again as the page grows, for 2 s at most or until the user scrolls
    const size = new ResizeObserver(() => {
      scrollTo({ top, behavior: 'instant' });
      if (Math.abs(scrollY - top) < 1) stop();
    });
    const stop = () => {
      size.disconnect();
      clearTimeout(timer);
      for (const t of USER_SCROLL) removeEventListener(t, stop, true);
      if (this.stopGrowing === stop) this.stopGrowing = null;
    };
    const timer = setTimeout(stop, 2000);
    for (const t of USER_SCROLL) addEventListener(t, stop, { capture: true, passive: true });
    size.observe(this.doc.body);
    this.stopGrowing = stop;
  }

  /** A page shown without a view transition (first load, browser without them). */
  withoutTransition(): void {
    if (this.current) return;
    this.entrance();
  }

  /** Colour of the page; null: the colours of the theme. */
  setTone(tone: Tone | null): void {
    this.wantedTone = tone;
    if (this.current || this.linuxNav) {
      // During a transition: with the new page, or right after
      if (!this.beforeUpdate) this.tonePending = true;
      return;
    }
    this.fade();
  }

  /** Entrance of the page (CSS under html.tb-entering). */
  private entrance(): void {
    // Linux: a GTK app shows its page at once (the motion is the push / pop of linuxStart)
    if (this.prefs.reducedMotion() || this.gtk) return;
    if (DESKTOP_OS === 'windows') {
      clearTimeout(this.timer);
      this.root.classList.remove('tb-win-entering');
      void this.root.offsetWidth;
      this.root.classList.add('tb-win-entering');
      // Only while it runs: a transform left on the page would hold what is fixed inside it
      this.timer = setTimeout(() => this.root.classList.remove('tb-win-entering'), 420);
      return;
    }
    clearTimeout(this.timer);
    this.root.classList.remove('tb-entering');
    // Restart the animations of a page entered again quickly
    void this.root.offsetWidth;
    this.root.classList.add('tb-entering');
    this.timer = setTimeout(() => this.root.classList.remove('tb-entering'), 1600);
  }

  /**
   * Names the card of room [id] and what morphs with it (data-vt), on the page shown: the card
   * clicked if it is this one ([cliquee]), else the first one on the screen (a room can be both
   * in the favourites and in its building), and the room page.
   */
  private name(id: string, clicked: boolean): void {
    if (!id) return;
    const all = [
      ...this.doc.querySelectorAll<HTMLElement>(`[data-vt][data-vt-id="${CSS.escape(id)}"]`),
    ];
    const cards = all.filter((e) => e.classList.contains('tb-room'));
    let card: HTMLElement | undefined;
    if (clicked && this.clickedCard?.id === id && this.clickedCard.el.isConnected)
      card = this.clickedCard.el;
    card ??= cards.find((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    card ??= cards[0];
    if (this.root.classList.contains('tb-card-full')) {
      // Phones: the card alone, or the whole page of the room
      const page = card ?? (all.length ? this.doc.querySelector<HTMLElement>('.tb-main') : null);
      if (!page) return;
      page.style.setProperty('view-transition-name', `room-card-${id}`);
      page.style.setProperty('view-transition-class', 'tb-card');
      page.dataset['vtFull'] = '';
      this.named.push(page);
      // The room page: its photo flies on its own, out of the card (flyPhoto)
      const photo = card
        ? null
        : all.find(
            (e) => e.dataset['vt'] === 'room-photo' && !e.classList.contains('tb-photo-empty'),
          );
      if (photo) {
        photo.style.setProperty('view-transition-name', `room-photo-${id}`);
        photo.style.setProperty('view-transition-class', 'tb-vt-photo');
        photo.dataset['vtClass'] = '';
        this.named.push(photo);
      }
      return;
    }
    const taken = new Set<string>();
    for (const e of all) {
      const name = e.dataset['vt']!;
      // Only one element per name: the one of the chosen card, or the only one of the room page
      if (taken.has(name) || (card && e !== card && !card.contains(e) && e.closest('.tb-room')))
        continue;
      taken.add(name);
      e.style.setProperty('view-transition-name', `${name}-${id}`);
      // Their layers: the photo under the card and its words (motion.css), whichever page it
      // comes from; a photo alone (the card has none to morph into) fades under the card
      if (!e.style.getPropertyValue('view-transition-class')) {
        e.style.setProperty(
          'view-transition-class',
          name === 'room-photo' ? 'tb-vt-photo' : 'tb-vt-text',
        );
        e.dataset['vtClass'] = '';
      }
      this.named.push(e);
    }
  }

  /** The photo of the room page, named for the transition, if the room has one. */
  private namedPhoto(id: string): HTMLElement | null {
    const p = this.named.find(
      (e) => e.style.getPropertyValue('view-transition-name') === `room-photo-${id}`,
    );
    return p && !p.classList.contains('tb-photo-empty') ? p : null;
  }

  /**
   * The photo of the room leaves its card on the dashboard and lands in its frame on the room
   * page; back, it flies from its frame into the card and melts into it. One group of the view
   * transition (the photo was already pictured on its own), animated by the compositor:
   * position, size, corners.
   */
  private flyPhoto(id: string, cardStart: Frame | null, backStart: Frame | null): void {
    const pseudo = `::view-transition-group(room-photo-${id})`;
    const options: KeyframeAnimationOptions = {
      duration: 520,
      easing: 'cubic-bezier(.2, .8, .2, 1)',
      fill: 'both',
      pseudoElement: pseudo,
    };
    if (cardStart) {
      const photo = this.namedPhoto(id);
      if (!photo) return;
      this.root.classList.add('tb-vt-flight');
      this.root.animate(images(cardStart, frame(photo)), options);
    } else if (backStart) {
      const card = this.named.find(
        (e) =>
          e.style.getPropertyValue('view-transition-name') === `room-card-${id}` &&
          e.classList.contains('tb-room'),
      );
      if (!card) return;
      this.root.classList.add('tb-vt-flight');
      this.root.animate(images(backStart, frame(card)), options);
      // It melts into the card at the end of the way
      this.root.animate(
        { opacity: [1, 1, 0], offset: [0, 0.6, 1] },
        { ...options, pseudoElement: `::view-transition-old(room-photo-${id})` },
      );
    }
  }

  private unname(): void {
    for (const e of this.named.splice(0)) {
      e.style.removeProperty('view-transition-name');
      // Set here only on the page; the cards carry their own (room-card.ts)
      if (
        (e.dataset['vtFull'] != null && !e.classList.contains('tb-room')) ||
        e.dataset['vtClass'] != null
      )
        e.style.removeProperty('view-transition-class');
      delete e.dataset['vtFull'];
      delete e.dataset['vtClass'];
    }
  }

  /** The room of the card clicked last (to open its page), as a number; null if none. */
  lastCardId(): number | null {
    const id = Number(this.clickedCard?.id);
    return this.clickedCard && Number.isFinite(id) ? id : null;
  }

  /** Back on the dashboard: the card reopens where it was on the screen when it was clicked. */
  private returnToCard(id: string): void {
    const card = this.doc.querySelector<HTMLElement>(`.tb-room[data-vt-id="${CSS.escape(id)}"]`);
    if (!card) return;
    // Its place when it was clicked (on the screen); kept inside the window if the click came
    // during a fling, the page still moving
    const at =
      this.clickedCard?.id === id ? this.clickedCard.top : (innerHeight - card.offsetHeight) / 2;
    const top = Math.min(Math.max(at, 0), Math.max(0, innerHeight - card.offsetHeight));
    scrollTo({
      top: Math.max(0, card.getBoundingClientRect().top + scrollY - top),
      behavior: 'instant',
    });
  }

  private fade(): void {
    this.tonePending = false;
    const tone = this.wantedTone;
    if (tone === this.shownTone) return;
    if (
      !this.doc.startViewTransition ||
      this.webkit ||
      this.prefs.reducedMotion() ||
      this.root.dataset['tint'] === 'off' ||
      this.doc.hidden
    ) {
      this.applyTone(tone);
      return;
    }
    this.root.classList.add('tb-tone-fade');
    const t = this.doc.startViewTransition(() => this.applyTone(tone));
    this.current = t;
    t.finished
      .catch(() => undefined)
      .then(() => {
        this.root.classList.remove('tb-tone-fade');
        if (this.current === t) this.current = null;
        if (this.tonePending) this.fade();
      });
  }

  private applyTone(tone: Tone | null): void {
    this.shownTone = tone;
    if (tone) this.root.dataset['tone'] = tone;
    else delete this.root.dataset['tone'];
  }
}

/** What the user does to scroll a page: the page is no longer put back as it grows. */
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

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

/** Linux: the swipe back under way (transitions.ts, swipeStart). */
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

/** Linux: a layer over the place of the pages (the shade, the sheet). */
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

function isCard(from: string, to: string): boolean {
  return (from === 'overview' && to === 'room/:id') || (from === 'room/:id' && to === 'overview');
}

interface Frame {
  x: number;
  y: number;
  l: number;
  h: number;
  radius: string;
}

/** Where an element is on the screen, and its corners. */
function frame(e: HTMLElement): Frame {
  const r = e.getBoundingClientRect();
  return {
    x: r.left,
    y: r.top,
    l: r.width,
    h: r.height,
    radius: getComputedStyle(e).borderRadius || '0px',
  };
}

/** Keyframes of a view transition group going from one frame to another. */
function images(from: Frame, to: Frame): Keyframe[] {
  return [
    {
      transform: `translate(${from.x}px, ${from.y}px)`,
      width: `${from.l}px`,
      height: `${from.h}px`,
      borderRadius: from.radius,
    },
    {
      transform: `translate(${to.x}px, ${to.y}px)`,
      width: `${to.l}px`,
      height: `${to.h}px`,
      borderRadius: to.radius,
    },
  ];
}
