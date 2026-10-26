import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';

import { PlatformService } from './platform';
import { PreferencesService } from './preferences';

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
 * Nothing moves when the system asks for less motion.
 */
@Injectable({ providedIn: 'root' })
export class TransitionsService {
  private readonly doc = inject(DOCUMENT) as Doc;
  private readonly prefs = inject(PreferencesService);
  private readonly platform = inject(PlatformService);
  private readonly root = this.doc.documentElement;

  private current: ViewTransition | null = null;
  /**
   * Safari and every browser of iOS: pictures of the glass (backdrop-filter) come out blurred.
   * The colour of the page then changes without pictures: the background glides to the new
   * colour (tokens.css, body::before), the rest of the palette follows at once.
   */
  private readonly webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\//.test(navigator.userAgent);
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

  constructor() {
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
      (e) => (this.byBrowser = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true),
      true,
    );
    this.doc.addEventListener(
      'click',
      (e) => {
        const card = (e.target as Element | null)?.closest?.('.tb-room') as HTMLElement | null;
        if (!card || !(e.target as Element).closest('.tb-stretched')) return;
        this.clickedCard = { id: card.dataset['vtId'] ?? '', el: card, top: card.getBoundingClientRect().top };
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
    const cardStart = card && forward && this.clickedCard?.id === id && this.clickedCard.el.isConnected ? frame(this.clickedCard.el) : null;
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
        if (!this.named.some((e) => e.style.getPropertyValue('view-transition-name') === `room-card-${id}`)) {
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
   * [fn] once the new page is in place: right away, or, during a page transition, between the
   * picture of the page left and the picture of the new one.
   */
  afterUpdate(fn: () => void): void {
    if (this.current && this.beforeUpdate) this.pending.push(fn);
    else fn();
  }

  /** End of the update of a page transition: the new page is there, its picture not taken yet. */
  private newPage(): void {
    if (!this.beforeUpdate) return;
    this.beforeUpdate = false;
    const f = this.onNewPage;
    this.onNewPage = null;
    f?.();
    for (const fn of this.pending.splice(0)) fn();
  }

  /** A page shown without a view transition (first load, browser without them). */
  withoutTransition(): void {
    if (this.current) return;
    this.entrance();
  }

  /** Colour of the page; null: the colours of the theme. */
  setTone(tone: Tone | null): void {
    this.wantedTone = tone;
    if (this.current) {
      // During a transition: with the new page, or right after
      if (!this.beforeUpdate) this.tonePending = true;
      return;
    }
    this.fade();
  }

  /** Entrance of the page (CSS under html.tb-entering). */
  private entrance(): void {
    if (this.prefs.reducedMotion()) return;
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
    const all = [...this.doc.querySelectorAll<HTMLElement>(`[data-vt][data-vt-id="${CSS.escape(id)}"]`)];
    const cards = all.filter((e) => e.classList.contains('tb-room'));
    let card: HTMLElement | undefined;
    if (clicked && this.clickedCard?.id === id && this.clickedCard.el.isConnected) card = this.clickedCard.el;
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
      const photo = card ? null : all.find((e) => e.dataset['vt'] === 'room-photo' && !e.classList.contains('tb-photo-empty'));
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
      if (taken.has(name) || (card && e !== card && !card.contains(e) && e.closest('.tb-room'))) continue;
      taken.add(name);
      e.style.setProperty('view-transition-name', `${name}-${id}`);
      // Their layers: the photo under the card and its words (motion.css), whichever page it
      // comes from; a photo alone (the card has none to morph into) fades under the card
      if (!e.style.getPropertyValue('view-transition-class')) {
        e.style.setProperty('view-transition-class', name === 'room-photo' ? 'tb-vt-photo' : 'tb-vt-text');
        e.dataset['vtClass'] = '';
      }
      this.named.push(e);
    }
  }

  /** The photo of the room page, named for the transition, if the room has one. */
  private namedPhoto(id: string): HTMLElement | null {
    const p = this.named.find((e) => e.style.getPropertyValue('view-transition-name') === `room-photo-${id}`);
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
    const options: KeyframeAnimationOptions = { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'both', pseudoElement: pseudo };
    if (cardStart) {
      const photo = this.namedPhoto(id);
      if (!photo) return;
      this.root.classList.add('tb-vt-flight');
      this.root.animate(images(cardStart, frame(photo)), options);
    } else if (backStart) {
      const card = this.named.find((e) => e.style.getPropertyValue('view-transition-name') === `room-card-${id}` && e.classList.contains('tb-room'));
      if (!card) return;
      this.root.classList.add('tb-vt-flight');
      this.root.animate(images(backStart, frame(card)), options);
      // It melts into the card at the end of the way
      this.root.animate({ opacity: [1, 1, 0], offset: [0, 0.6, 1] }, { ...options, pseudoElement: `::view-transition-old(room-photo-${id})` });
    }
  }

  private unname(): void {
    for (const e of this.named.splice(0)) {
      e.style.removeProperty('view-transition-name');
      // Set here only on the page; the cards carry their own (room-card.ts)
      if ((e.dataset['vtFull'] != null && !e.classList.contains('tb-room')) || e.dataset['vtClass'] != null) e.style.removeProperty('view-transition-class');
      delete e.dataset['vtFull'];
      delete e.dataset['vtClass'];
    }
  }

  /** Back on the dashboard: the card reopens where it was on the screen when it was clicked. */
  private returnToCard(id: string): void {
    const card = this.doc.querySelector<HTMLElement>(`.tb-room[data-vt-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const top = this.clickedCard?.id === id ? this.clickedCard.top : (innerHeight - card.offsetHeight) / 2;
    scrollTo(0, Math.max(0, card.getBoundingClientRect().top + scrollY - top));
  }

  private fade(): void {
    this.tonePending = false;
    const tone = this.wantedTone;
    if (tone === this.shownTone) return;
    if (!this.doc.startViewTransition || this.webkit || this.prefs.reducedMotion() || this.root.dataset['tint'] === 'off' || this.doc.hidden) {
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

function sheet(s: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let r = s;
  while (r.firstChild) r = r.firstChild;
  return r;
}

/** Path of the deepest route ("overview", "room/:id"…). */
function path(s: ActivatedRouteSnapshot): string {
  return sheet(s).routeConfig?.path ?? '';
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
  return { x: r.left, y: r.top, l: r.width, h: r.height, radius: getComputedStyle(e).borderRadius || '0px' };
}

/** Keyframes of a view transition group going from one frame to another. */
function images(from: Frame, to: Frame): Keyframe[] {
  return [
    { transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.l}px`, height: `${from.h}px`, borderRadius: from.radius },
    { transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.l}px`, height: `${to.h}px`, borderRadius: to.radius },
  ];
}
