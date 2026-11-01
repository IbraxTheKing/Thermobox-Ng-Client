import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject } from '@angular/core';

import { PlateformeService } from '../core/plateforme';
import { PreferencesService } from '../core/preferences';

/** Pull (px, after resistance) past which letting go refreshes. */
const SEUIL = 72;
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
 *   readonly tirer = inject(TirerPourActualiser).activer(() => this.actualiser());   // in a page
 *   @if (!tirer()) { <button …>Actualiser</button> }
 */
@Injectable({ providedIn: 'root' })
export class TirerPourActualiser {
  private readonly doc = inject(DOCUMENT);
  private readonly plateforme = inject(PlateformeService);
  private readonly prefs = inject(PreferencesService);

  /**
   * For the page being built (call from its constructor). Returns whether the gesture is there
   * (a phone held upright, with touch): the page then hides its « Actualiser » button.
   */
  activer(actualiser: () => Promise<unknown>): () => boolean {
    const tactile = 'ontouchstart' in window;
    const actif = computed(() => tactile && this.plateforme.barreBas());

    const root = this.doc.documentElement;
    const indicateur = this.doc.createElement('div');
    indicateur.className = 'tb-tirer';
    indicateur.setAttribute('aria-hidden', 'true');
    indicateur.innerHTML = '<span class="tb-tirer-rond"><i class="pi pi-arrow-down"></i></span>';
    this.doc.body.appendChild(indicateur);
    root.classList.add('tb-tirer-page');

    let g: { y0: number; x0: number; tire: number; mode: '?' | 'v' | 'non'; passe: boolean } | null = null;
    let enCours = false;

    const poser = (tire: number, transition: boolean) => {
      indicateur.style.transition = transition ? 'transform .3s cubic-bezier(.2, 0, 0, 1), opacity .3s ease' : 'none';
      indicateur.style.transform = `translate(-50%, ${tire - 56}px)`;
      indicateur.style.opacity = tire > 4 ? '1' : '0';
      indicateur.style.setProperty('--tb-tirer-p', String(Math.min(1, tire / SEUIL)));
    };

    const debut = (e: TouchEvent) => {
      g = null;
      if (!actif() || enCours || e.touches.length !== 1 || scrollY > 0) return;
      // Not from inside something that scrolls or opens (sheet, chart, list…)
      if ((e.target as Element | null)?.closest?.('.tb-dialog, .tb-scrim, .tb-graphique, input, textarea, select, [data-sans-geste]')) return;
      const t = e.touches[0];
      g = { y0: t.clientY, x0: t.clientX, tire: 0, mode: '?', passe: false };
    };

    const bouger = (e: TouchEvent) => {
      if (!g || g.mode === 'non') return;
      const t = e.touches[0];
      const dy = t.clientY - g.y0;
      const dx = t.clientX - g.x0;
      if (g.mode === '?') {
        if (Math.hypot(dx, dy) < 8) return;
        // Down and from the very top: the gesture; anything else is the page's
        g.mode = dy > 0 && Math.abs(dy) > Math.abs(dx) && scrollY <= 0 ? 'v' : 'non';
        if (g.mode === 'non') return;
        indicateur.classList.add('tb-tirer-on');
      }
      e.preventDefault();
      g.tire = Math.min(MAXIMUM, Math.max(0, dy * RESISTANCE));
      poser(g.tire, false);
      const passe = g.tire >= SEUIL;
      if (passe !== g.passe) {
        g.passe = passe;
        indicateur.classList.toggle('tb-tirer-pret', passe);
        if (passe) this.plateforme.vibrer();
      }
    };

    const fin = () => {
      const geste = g;
      g = null;
      if (!geste || geste.mode !== 'v') return;
      if (!geste.passe) {
        rentrer();
        return;
      }
      enCours = true;
      indicateur.classList.add('tb-tirer-charge');
      poser(SEUIL * 0.8, this.prefs.animer());
      void actualiser()
        .catch(() => undefined)
        .finally(() => {
          enCours = false;
          rentrer();
        });
    };

    const rentrer = () => {
      poser(0, this.prefs.animer());
      indicateur.classList.remove('tb-tirer-pret', 'tb-tirer-charge');
      setTimeout(() => indicateur.classList.remove('tb-tirer-on'), 300);
    };

    poser(0, false);
    this.doc.addEventListener('touchstart', debut, { passive: true });
    this.doc.addEventListener('touchmove', bouger, { passive: false });
    this.doc.addEventListener('touchend', fin, { passive: true });
    this.doc.addEventListener('touchcancel', fin, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('touchstart', debut);
      this.doc.removeEventListener('touchmove', bouger);
      this.doc.removeEventListener('touchend', fin);
      this.doc.removeEventListener('touchcancel', fin);
      indicateur.remove();
      root.classList.remove('tb-tirer-page');
    });
    return actif;
  }
}
