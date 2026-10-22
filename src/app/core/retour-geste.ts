import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { NavigationEnd, NavigationCancel, NavigationError, Router } from '@angular/router';
import { filter, take } from 'rxjs';

import { PlateformeService } from './plateforme';
import { PreferencesService } from './preferences';
import { TransitionsService } from './transitions';

/** Where a horizontal swipe belongs to what is under the finger, not to the page. */
const EXCLUS = '.tb-graphique, .tb-summary, .tb-lecture-valeurs, .tb-table, .tb-chips, .tb-segmented, input, textarea, select, .tb-stepper, .tb-dialog, .tb-rail, [data-sans-geste]';
/** Share of the screen width, or speed (px/ms), past which letting go goes back. */
const SEUIL = 0.22;
const VITESSE = 0.5;

/**
 * Phones: swipe a page to the right to go back, as in native apps. The page shrinks and follows the
 * finger (the bars stay in place); let go far or fast enough and it goes back, the salle page then
 * flowing back into its dashboard card (TransitionsService), from where the finger left it; else
 * it springs back.
 *
 * Needed in the installed app (home screen, Capacitor), which has no back swipe of its own; in
 * Safari the swipe from the very edge still belongs to the browser.
 *
 *   inject(RetourGesteService).activer(() => this.retour());   // in the constructor of a page
 */
@Injectable({ providedIn: 'root' })
export class RetourGesteService {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly plateforme = inject(PlateformeService);
  private readonly prefs = inject(PreferencesService);
  private readonly transitions = inject(TransitionsService);

  /** For the page being built (call from its constructor): its swipe goes back with [retour]. */
  activer(retour: () => void): void {
    if (!('ontouchstart' in window)) return;
    const root = this.doc.documentElement;
    let g: { x0: number; y0: number; t: number; dx: number; vx: number; mode: '?' | 'h' | 'non'; main: HTMLElement; passe: boolean } | null = null;

    const poser = (dx: number, dy: number) => {
      if (!g) return;
      const p = Math.min(Math.max(dx / innerWidth, 0), 1);
      g.main.style.transform = `translate(${dx * 0.55}px, ${dy * 0.2}px) scale(${1 - p * 0.16})`;
      // Crossing the threshold: a tap of the phone, as in iOS
      const passe = p > SEUIL;
      if (passe !== g.passe) {
        g.passe = passe;
        this.plateforme.vibrer();
      }
    };

    const debut = (e: TouchEvent) => {
      g = null;
      if (e.touches.length !== 1 || !this.plateforme.barreBas() || this.doc.body.style.overflow === 'hidden') return;
      if ((e.target as Element | null)?.closest?.(EXCLUS)) return;
      const main = this.doc.querySelector<HTMLElement>('.tb-main');
      if (!main) return;
      const t = e.touches[0];
      g = { x0: t.clientX, y0: t.clientY, t: e.timeStamp, dx: 0, vx: 0, mode: '?', main, passe: false };
    };

    const bouger = (e: TouchEvent) => {
      if (!g || g.mode === 'non') return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (g.mode === '?') {
        if (Math.hypot(dx, dy) < 10) return;
        g.mode = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.4 ? 'h' : 'non';
        if (g.mode === 'non') return;
        // The page shrinks around the middle of what is on screen
        g.main.style.transition = 'none';
        g.main.style.transformOrigin = `50% ${scrollY + innerHeight * 0.45 - g.main.offsetTop}px`;
        root.classList.add('tb-geste-retour');
      }
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - g.t);
      g.vx = (dx - g.dx) / dt;
      g.dx = dx;
      g.t = e.timeStamp;
      if (this.prefs.animer()) poser(dx, dy);
    };

    const fin = () => {
      const geste = g;
      g = null;
      if (!geste || geste.mode !== 'h') return;
      const main = geste.main;
      if (geste.dx / innerWidth > SEUIL || geste.vx > VITESSE) {
        // Goes back from where it is: the transition takes its picture there. The page is put
        // straight again once the next one is in place (before its picture).
        this.router.events
          .pipe(
            filter((ev) => ev instanceof NavigationEnd || ev instanceof NavigationCancel || ev instanceof NavigationError),
            take(1),
          )
          // Not before the picture of the page being left is taken (it would be taken straight)
          .subscribe(() => this.transitions.apresMaj(() => remettre(main, false)));
        setTimeout(() => remettre(main, false), 1500);
        // Once the touch is over: a transition started inside the touchend is cut short by the
        // browser (Chrome aborts it, « invalid state »)
        setTimeout(retour, 30);
        return;
      }
      remettre(main, true);
    };

    const remettre = (main: HTMLElement, ressort: boolean) => {
      if (!main.style.transform) return;
      main.style.transition = ressort ? 'transform .45s cubic-bezier(.2, .9, .3, 1.12)' : 'none';
      main.style.transform = '';
      const finir = () => {
        main.style.transition = '';
        main.style.transformOrigin = '';
        root.classList.remove('tb-geste-retour');
      };
      if (ressort) setTimeout(finir, 460);
      else finir();
    };

    this.doc.addEventListener('touchstart', debut, { passive: true });
    this.doc.addEventListener('touchmove', bouger, { passive: false });
    this.doc.addEventListener('touchend', fin, { passive: true });
    this.doc.addEventListener('touchcancel', fin, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('touchstart', debut);
      this.doc.removeEventListener('touchmove', bouger);
      this.doc.removeEventListener('touchend', fin);
      this.doc.removeEventListener('touchcancel', fin);
    });
  }
}
