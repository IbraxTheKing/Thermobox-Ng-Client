import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';

import { PlateformeService } from './plateforme';
import { PreferencesService } from './preferences';

/** State whose colour the page takes (« Couleurs selon l'état »). */
export type Ton = 'stable' | 'chauffe' | 'chaud' | 'inconnu';

type Doc = Document & { startViewTransition?: (f: () => void | Promise<void>) => ViewTransition };

/**
 * Motion between pages, as tbAnim of the JSF interface, for a single-page app:
 *
 * - every page change goes through a view transition (cross-fade, the dashboard card morphing into
 *   the salle page), and the new page makes its entrance (html.tb-entering, 1.6 s: the head rises,
 *   the cards follow one after the other, their curves draw themselves);
 * - dashboard ↔ salle: only the card moves (html.tb-carte), nothing else pops in. On phones
 *   (html.tb-carte-plein) the card opens into the whole salle page and the page closes back into
 *   it (Material container transform): card and page are the same width there, a card morphing
 *   into the card of the page did not show. Only that card
 *   and its salle page carry view-transition names (data-vt), and only during the transition: a
 *   name on every card made each of them a group of its own, every page change blurred and faded
 *   the whole dashboard piece by piece;
 * - other page changes: no picture of the pages at all (the new page is there at once and makes
 *   its entrance, live; pictures of glass came out blurred);
 * - the colour of the page (state of the salle shown, dashboard filter) changes through a
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
  private readonly plateforme = inject(PlateformeService);
  private readonly root = this.doc.documentElement;

  private courante: ViewTransition | null = null;
  /**
   * Safari and every browser of iOS: pictures of the glass (backdrop-filter) come out blurred.
   * The colour of the page then changes without pictures: the background glides to the new
   * colour (tokens.css, body::before), the rest of the palette follows at once.
   */
  private readonly webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium|Edg\//.test(navigator.userAgent);
  /** The new page is not in place yet: a colour asked now goes with it. */
  private avantMaj = false;
  private minuterie?: ReturnType<typeof setTimeout>;

  private tonAffiche: Ton | null = null;
  private tonVoulu: Ton | null = null;
  private tonPrevu = false;

  /** Card clicked on the dashboard, and where it was on the screen (to come back to it). */
  private carteCliquee: { id: string; el: HTMLElement; haut: number } | null = null;
  private nommes: HTMLElement[] = [];

  /**
   * The browser has already shown the way back itself (swipe from the edge in Safari, back
   * gesture of Android): no second animation on top of it.
   */
  private parLeNavigateur = false;
  /** What to do on the new page before its picture is taken (names, colour, scroll…). */
  private surNouvellePage: (() => void) | null = null;
  private enAttente: (() => void)[] = [];

  constructor() {
    // The picture of the new page is taken as soon as the update callback is done: what must be
    // in it (names of what morphs, colour, page put straight) is done at the end of that
    // callback, not after updateCallbackDone (too late: the picture is already taken)
    const demarrer = this.doc.startViewTransition?.bind(this.doc);
    if (demarrer) {
      this.doc.startViewTransition = (maj?: () => void | Promise<void>) =>
        demarrer(async () => {
          try {
            await maj?.();
          } finally {
            this.nouvellePage();
          }
        });
    }
    addEventListener(
      'popstate',
      (e) => (this.parLeNavigateur = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true),
      true,
    );
    this.doc.addEventListener(
      'click',
      (e) => {
        const carte = (e.target as Element | null)?.closest?.('.tb-room') as HTMLElement | null;
        if (!carte || !(e.target as Element).closest('.tb-stretched')) return;
        this.carteCliquee = { id: carte.dataset['vtId'] ?? '', el: carte, haut: carte.getBoundingClientRect().top };
      },
      true,
    );
  }

  /** Called by the router for each page change (app.config.ts). */
  surTransition({ transition, from, to }: ViewTransitionInfo): void {
    const parLeNavigateur = this.parLeNavigateur;
    this.parLeNavigateur = false;
    if (this.prefs.mouvementReduit() || parLeNavigateur) {
      transition.skipTransition();
      return;
    }
    const depuis = chemin(from);
    const vers = chemin(to);
    const carte = estCarte(depuis, vers);
    const id = carte ? String(feuille(vers === 'salle/:id' ? to : from).params['id'] ?? '') : '';
    // Between pages: no pictures of the pages. A picture of the glass (backdrop-filter) is drawn
    // without its blur or blurred as a whole depending on the browser, and every card of the
    // dashboard showed blurred, then popped back. The new page is there at once, live, and makes
    // its entrance. Only the dashboard card morphing into its salle page needs pictures.
    if (!carte) transition.skipTransition();
    this.courante = transition;
    this.avantMaj = true;
    this.root.classList.toggle('tb-carte', carte);
    this.root.classList.toggle('tb-carte-plein', carte && this.plateforme.barreBas());
    // A real transition: what morphs must not also slide in (jsf.css, .tb-vt-in)
    this.root.classList.toggle('tb-vt-in', carte);
    // The card (or the salle page) we leave: its picture is taken on the next frame
    if (carte) this.nommer(id, depuis === 'apercu');
    this.surNouvellePage = () => {
      // The page we arrive on, before its picture is taken
      if (carte) {
        this.denommer();
        if (vers === 'apercu') this.revenirALaCarte(id);
        this.nommer(id, false);
        // Nothing to morph into (salle page not ready, card in a folded section): the card
        // would stay on its own in the middle of the new page, so no transition at all
        if (!this.nommes.some((e) => e.style.getPropertyValue('view-transition-name') === `salle-card-${id}`)) {
          this.denommer();
          transition.skipTransition();
        }
      }
      // Part of the new picture: no second cross-fade
      this.appliquerTon(this.tonVoulu);
      if (!carte) this.entree();
    };
    // Not through the wrapped startViewTransition (created before this service): late, but done
    transition.updateCallbackDone.catch(() => undefined).then(() => this.nouvellePage());
    transition.finished
      .catch(() => undefined)
      .then(() => {
        this.denommer();
        if (this.courante !== transition) return;
        this.courante = null;
        this.root.classList.remove('tb-vt-in', 'tb-carte', 'tb-carte-plein');
        if (this.tonPrevu) this.fondu();
      });
  }

  /**
   * [fn] once the new page is in place: right away, or, during a page transition, between the
   * picture of the page left and the picture of the new one.
   */
  apresMaj(fn: () => void): void {
    if (this.courante && this.avantMaj) this.enAttente.push(fn);
    else fn();
  }

  /** End of the update of a page transition: the new page is there, its picture not taken yet. */
  private nouvellePage(): void {
    if (!this.avantMaj) return;
    this.avantMaj = false;
    const f = this.surNouvellePage;
    this.surNouvellePage = null;
    f?.();
    for (const fn of this.enAttente.splice(0)) fn();
  }

  /** A page shown without a view transition (first load, browser without them). */
  sansTransition(): void {
    if (this.courante) return;
    this.entree();
  }

  /** Colour of the page; null: the colours of the theme. */
  definirTon(ton: Ton | null): void {
    this.tonVoulu = ton;
    if (this.courante) {
      // During a transition: with the new page, or right after
      if (!this.avantMaj) this.tonPrevu = true;
      return;
    }
    this.fondu();
  }

  /** Entrance of the page (CSS under html.tb-entering). */
  private entree(): void {
    if (this.prefs.mouvementReduit()) return;
    clearTimeout(this.minuterie);
    this.root.classList.remove('tb-entering');
    // Restart the animations of a page entered again quickly
    void this.root.offsetWidth;
    this.root.classList.add('tb-entering');
    this.minuterie = setTimeout(() => this.root.classList.remove('tb-entering'), 1600);
  }

  /**
   * Names the card of salle [id] and what morphs with it (data-vt), on the page shown: the card
   * clicked if it is this one ([cliquee]), else the first one on the screen (a salle can be both
   * in the favourites and in its building), and the salle page.
   */
  private nommer(id: string, cliquee: boolean): void {
    if (!id) return;
    const tous = [...this.doc.querySelectorAll<HTMLElement>(`[data-vt][data-vt-id="${CSS.escape(id)}"]`)];
    const cartes = tous.filter((e) => e.classList.contains('tb-room'));
    let carte: HTMLElement | undefined;
    if (cliquee && this.carteCliquee?.id === id && this.carteCliquee.el.isConnected) carte = this.carteCliquee.el;
    carte ??= cartes.find((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    carte ??= cartes[0];
    if (this.root.classList.contains('tb-carte-plein')) {
      // Phones: the card alone, or the whole page of the salle
      const page = carte ?? (tous.length ? this.doc.querySelector<HTMLElement>('.tb-main') : null);
      if (!page) return;
      page.style.setProperty('view-transition-name', `salle-card-${id}`);
      page.style.setProperty('view-transition-class', 'tb-card');
      page.dataset['vtPlein'] = '';
      this.nommes.push(page);
      return;
    }
    const pris = new Set<string>();
    for (const e of tous) {
      const nom = e.dataset['vt']!;
      // Only one element per name: the one of the chosen card, or the only one of the salle page
      if (pris.has(nom) || (carte && e !== carte && !carte.contains(e) && e.closest('.tb-room'))) continue;
      pris.add(nom);
      e.style.setProperty('view-transition-name', `${nom}-${id}`);
      // Their layers: the photo under the card and its words (motion.css), whichever page it
      // comes from; a photo alone (the card has none to morph into) fades under the card
      if (!e.style.getPropertyValue('view-transition-class')) {
        e.style.setProperty('view-transition-class', nom === 'salle-photo' ? 'tb-vt-photo' : 'tb-vt-texte');
        e.dataset['vtClasse'] = '';
      }
      this.nommes.push(e);
    }
  }

  private denommer(): void {
    for (const e of this.nommes.splice(0)) {
      e.style.removeProperty('view-transition-name');
      // Set here only on the page; the cards carry their own (salle-card.ts)
      if ((e.dataset['vtPlein'] != null && !e.classList.contains('tb-room')) || e.dataset['vtClasse'] != null) e.style.removeProperty('view-transition-class');
      delete e.dataset['vtPlein'];
      delete e.dataset['vtClasse'];
    }
  }

  /** Back on the dashboard: the card reopens where it was on the screen when it was clicked. */
  private revenirALaCarte(id: string): void {
    const carte = this.doc.querySelector<HTMLElement>(`.tb-room[data-vt-id="${CSS.escape(id)}"]`);
    if (!carte) return;
    const haut = this.carteCliquee?.id === id ? this.carteCliquee.haut : (innerHeight - carte.offsetHeight) / 2;
    scrollTo(0, Math.max(0, carte.getBoundingClientRect().top + scrollY - haut));
  }

  private fondu(): void {
    this.tonPrevu = false;
    const ton = this.tonVoulu;
    if (ton === this.tonAffiche) return;
    if (!this.doc.startViewTransition || this.webkit || this.prefs.mouvementReduit() || this.root.dataset['teinte'] === 'off' || this.doc.hidden) {
      this.appliquerTon(ton);
      return;
    }
    this.root.classList.add('tb-ton-fondu');
    const t = this.doc.startViewTransition(() => this.appliquerTon(ton));
    this.courante = t;
    t.finished
      .catch(() => undefined)
      .then(() => {
        this.root.classList.remove('tb-ton-fondu');
        if (this.courante === t) this.courante = null;
        if (this.tonPrevu) this.fondu();
      });
  }

  private appliquerTon(ton: Ton | null): void {
    this.tonAffiche = ton;
    if (ton) this.root.dataset['ton'] = ton;
    else delete this.root.dataset['ton'];
  }
}

function feuille(s: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let r = s;
  while (r.firstChild) r = r.firstChild;
  return r;
}

/** Path of the deepest route ("apercu", "salle/:id"…). */
function chemin(s: ActivatedRouteSnapshot): string {
  return feuille(s).routeConfig?.path ?? '';
}

function estCarte(depuis: string, vers: string): boolean {
  return (depuis === 'apercu' && vers === 'salle/:id') || (depuis === 'salle/:id' && vers === 'apercu');
}
