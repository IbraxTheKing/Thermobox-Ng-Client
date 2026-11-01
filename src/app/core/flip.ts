import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';

import { PreferencesService } from './preferences';

interface Avant {
  rect: DOMRect;
  favori: boolean;
  /** Copy of an element on screen, to fade it out where it was if the change removes it. */
  fantome: HTMLElement | null;
}

/** Ease-out with a slight overshoot, as the springs of iOS / Material. */
const RESSORT = 'cubic-bezier(.2, .9, .25, 1.08)';

/**
 * Lists that rearrange themselves (tbFlip of the JSF interface): when a change moves, adds or
 * removes the elements marked data-flip="key" (cards of the dashboard, rows of Gestion…), each one
 * glides from where it was to where it is now, the new ones rise in one after the other, the ones
 * that go fade out where they were. A salle put in the favourites flies from its building to the
 * favourites, its star spins.
 *
 *   this.flip.animer(() => this.recherche.set(v));
 *
 * Only transform and opacity, with the Web Animations API: the compositor does it.
 */
@Injectable({ providedIn: 'root' })
export class FlipService {
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly prefs = inject(PreferencesService);

  /** Runs [changer] (signals), then animates the [data-flip] elements to their new places. */
  animer(changer: () => void): void {
    if (!this.prefs.animer()) {
      changer();
      return;
    }
    const avant = this.mesurer();
    changer();
    afterNextRender({ read: () => this.jouer(avant) }, { injector: this.injector });
  }

  private mesurer(): Map<string, Avant> {
    const m = new Map<string, Avant>();
    for (const el of this.doc.querySelectorAll<HTMLElement>('[data-flip]')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      const visible = rect.bottom > 0 && rect.top < innerHeight;
      m.set(el.dataset['flip']!, { rect, favori: !!el.querySelector('.tb-fav-on'), fantome: visible ? (el.cloneNode(true) as HTMLElement) : null });
    }
    return m;
  }

  private jouer(avant: Map<string, Avant>): void {
    let nouveaux = 0;
    const presents = new Set<string>();
    for (const el of this.doc.querySelectorAll<HTMLElement>('[data-flip]')) {
      const cle = el.dataset['flip']!;
      presents.add(cle);
      const a = avant.get(cle);
      const now = el.getBoundingClientRect();
      if (!now.width && !now.height) continue;
      if (a) {
        const dx = a.rect.left - now.left;
        const dy = a.rect.top - now.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          // Far moves (a card going to the favourites) take a little longer
          const duree = Math.min(820, 480 + Math.hypot(dx, dy) * 0.25);
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: duree, easing: RESSORT });
        }
        const etoile = el.querySelector<HTMLElement>('.tb-fav .pi');
        const favori = !!el.querySelector('.tb-fav-on');
        if (etoile && favori !== a.favori) {
          etoile.animate(
            favori
              ? [{ transform: 'scale(.2) rotate(-144deg)' }, { transform: 'scale(1.35) rotate(12deg)', offset: 0.6 }, { transform: 'none' }]
              : [{ transform: 'scale(1.3)' }, { transform: 'scale(.8)', offset: 0.5 }, { transform: 'none' }],
            { duration: favori ? 650 : 380, easing: 'ease-out' },
          );
        }
      } else if (now.bottom > 0 && now.top < innerHeight) {
        el.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], {
          duration: 460,
          delay: Math.min(nouveaux++, 10) * 35,
          easing: RESSORT,
          fill: 'backwards',
        });
      }
    }
    // Gone: their copy fades out where they were
    for (const [cle, a] of avant) {
      if (presents.has(cle) || !a.fantome) continue;
      const f = a.fantome;
      f.removeAttribute('id');
      f.removeAttribute('data-flip');
      f.setAttribute('aria-hidden', 'true');
      f.querySelectorAll('[data-flip], [data-vt]').forEach((x) => x.removeAttribute('data-flip'));
      Object.assign(f.style, {
        position: 'fixed',
        left: `${a.rect.left}px`,
        top: `${a.rect.top}px`,
        width: `${a.rect.width}px`,
        height: `${a.rect.height}px`,
        margin: '0',
        zIndex: '5',
        pointerEvents: 'none',
        viewTransitionName: 'none',
      });
      this.doc.body.appendChild(f);
      f.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px)' }], {
        duration: 300,
        easing: 'ease-in',
        fill: 'forwards',
      }).finished.then(
        () => f.remove(),
        () => f.remove(),
      );
    }
  }
}
