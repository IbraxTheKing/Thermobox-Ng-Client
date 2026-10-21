import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';

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
 * - dashboard ↔ salle: only the card moves (html.tb-carte), nothing else pops in;
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
  private readonly root = this.doc.documentElement;

  private courante: ViewTransition | null = null;
  /** The new page is not in place yet: a colour asked now goes with it. */
  private avantMaj = false;
  private minuterie?: ReturnType<typeof setTimeout>;

  private tonAffiche: Ton | null = null;
  private tonVoulu: Ton | null = null;
  private tonPrevu = false;

  /** Called by the router for each page change (app.config.ts). */
  surTransition({ transition, from, to }: ViewTransitionInfo): void {
    if (this.prefs.mouvementReduit()) {
      transition.skipTransition();
      return;
    }
    const carte = estCarte(chemin(from), chemin(to));
    this.courante = transition;
    this.avantMaj = true;
    this.root.classList.toggle('tb-carte', carte);
    this.root.classList.add('tb-vt-in');
    transition.updateCallbackDone
      .catch(() => undefined)
      .then(() => {
        this.avantMaj = false;
        // Part of the new picture: no second cross-fade
        this.appliquerTon(this.tonVoulu);
        if (!carte) this.entree();
      });
    transition.finished
      .catch(() => undefined)
      .then(() => {
        if (this.courante !== transition) return;
        this.courante = null;
        this.root.classList.remove('tb-vt-in', 'tb-carte');
        if (this.tonPrevu) this.fondu();
      });
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

  private fondu(): void {
    this.tonPrevu = false;
    const ton = this.tonVoulu;
    if (ton === this.tonAffiche) return;
    if (!this.doc.startViewTransition || this.prefs.mouvementReduit() || this.root.dataset['teinte'] === 'off' || this.doc.hidden) {
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

/** Path of the deepest route ("apercu", "salle/:id"…). */
function chemin(s: ActivatedRouteSnapshot): string {
  let r = s;
  while (r.firstChild) r = r.firstChild;
  return r.routeConfig?.path ?? '';
}

function estCarte(depuis: string, vers: string): boolean {
  return (depuis === 'apercu' && vers === 'salle/:id') || (depuis === 'salle/:id' && vers === 'apercu');
}
