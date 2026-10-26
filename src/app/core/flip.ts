import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';

import { PreferencesService } from './preferences';

interface FlipState {
  rect: DOMRect;
  favorite: boolean;
  /** Copy of an element on screen, to fade it out where it was if the change removes it. */
  ghost: HTMLElement | null;
}

/** Ease-out with a slight overshoot, as the springs of iOS / Material. */
const SPRING = 'cubic-bezier(.2, .9, .25, 1.08)';

/**
 * Lists that rearrange themselves (tbFlip of the JSF interface): when a change moves, adds or
 * removes the elements marked data-flip="key" (cards of the dashboard, rows of Gestion…), each one
 * glides from where it was to where it is now, the new ones rise in one after the other, the ones
 * that go fade out where they were. A room put in the favourites flies from its building to the
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
  animate(change: () => void): void {
    if (!this.prefs.animate()) {
      change();
      return;
    }
    const before = this.measure();
    change();
    afterNextRender({ read: () => this.play(before) }, { injector: this.injector });
  }

  private measure(): Map<string, FlipState> {
    const m = new Map<string, FlipState>();
    for (const el of this.doc.querySelectorAll<HTMLElement>('[data-flip]')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      const visible = rect.bottom > 0 && rect.top < innerHeight;
      m.set(el.dataset['flip']!, { rect, favorite: !!el.querySelector('.tb-fav-on'), ghost: visible ? (el.cloneNode(true) as HTMLElement) : null });
    }
    return m;
  }

  private play(before: Map<string, FlipState>): void {
    let added = 0;
    const present = new Set<string>();
    for (const el of this.doc.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = el.dataset['flip']!;
      present.add(key);
      const a = before.get(key);
      const now = el.getBoundingClientRect();
      if (!now.width && !now.height) continue;
      if (a) {
        const dx = a.rect.left - now.left;
        const dy = a.rect.top - now.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          // Far moves (a card going to the favourites) take a little longer
          const duration = Math.min(820, 480 + Math.hypot(dx, dy) * 0.25);
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: duration, easing: SPRING });
        }
        const star = el.querySelector<HTMLElement>('.tb-fav .pi');
        const favorite = !!el.querySelector('.tb-fav-on');
        if (star && favorite !== a.favorite) {
          star.animate(
            favorite
              ? [{ transform: 'scale(.2) rotate(-144deg)' }, { transform: 'scale(1.35) rotate(12deg)', offset: 0.6 }, { transform: 'none' }]
              : [{ transform: 'scale(1.3)' }, { transform: 'scale(.8)', offset: 0.5 }, { transform: 'none' }],
            { duration: favorite ? 650 : 380, easing: 'ease-out' },
          );
        }
      } else if (now.bottom > 0 && now.top < innerHeight) {
        el.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], {
          duration: 460,
          delay: Math.min(added++, 10) * 35,
          easing: SPRING,
          fill: 'backwards',
        });
      }
    }
    // Gone: their copy fades out where they were
    for (const [key, a] of before) {
      if (present.has(key) || !a.ghost) continue;
      const f = a.ghost;
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
