import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { PreferencesService } from './preferences';

/**
 * Small animations of the whole app that don't belong to one page:
 * - segmented controls (24 h / 7 j / 30 j, Salles / Bâtiments, Clair / Sombre / Système…): the
 *   selected pill slides from the old option to the new one instead of jumping.
 */
@Injectable({ providedIn: 'root' })
export class AnimationsService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);

  constructor() {
    this.doc.addEventListener('click', (e) => this.surSegment(e), true);
  }

  private surSegment(e: Event): void {
    const bouton = (e.target as Element | null)?.closest?.('.tb-segmented > button') as HTMLElement | null;
    if (!bouton || !this.prefs.animer()) return;
    const groupe = bouton.parentElement!;
    const avant = groupe.querySelector<HTMLElement>(':scope > button.tb-seg-on');
    if (!avant || avant === bouton) return;
    const depart = this.rect(avant, groupe);
    // After Angular has moved the selection (next frames)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const apres = groupe.querySelector<HTMLElement>(':scope > button.tb-seg-on');
        if (!apres || apres === avant) return;
        const arrivee = this.rect(apres, groupe);
        const style = getComputedStyle(apres);
        const pilule = this.doc.createElement('span');
        pilule.className = 'tb-seg-pilule';
        pilule.setAttribute('aria-hidden', 'true');
        Object.assign(pilule.style, {
          left: `${arrivee.x}px`,
          top: `${arrivee.y}px`,
          width: `${arrivee.w}px`,
          height: `${arrivee.h}px`,
          background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? style.backgroundImage : style.backgroundColor,
          boxShadow: style.boxShadow,
          borderRadius: style.borderRadius,
        });
        if (getComputedStyle(groupe).position === 'static') groupe.style.position = 'relative';
        groupe.prepend(pilule);
        apres.classList.add('tb-seg-glisse');
        const sx = depart.w / arrivee.w;
        pilule
          .animate(
            [
              { transform: `translate(${depart.x - arrivee.x + (depart.w - arrivee.w) / 2}px, ${depart.y - arrivee.y}px) scaleX(${sx})` },
              { transform: 'none' },
            ],
            { duration: 420, easing: 'cubic-bezier(.2, .9, .25, 1.1)' },
          )
          .finished.finally(() => {
            apres.classList.remove('tb-seg-glisse');
            pilule.remove();
          });
      }),
    );
  }

  private rect(el: HTMLElement, dans: HTMLElement): { x: number; y: number; w: number; h: number } {
    const a = el.getBoundingClientRect();
    const b = dans.getBoundingClientRect();
    return { x: a.left - b.left - dans.clientLeft, y: a.top - b.top - dans.clientTop, w: a.width, h: a.height };
  }
}
