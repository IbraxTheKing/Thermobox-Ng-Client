import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { PreferencesService } from './preferences';

/**
 * Small animations of the whole app that don't belong to one page:
 * - segmented controls (24 h / 7 j / 30 j, Rooms / Buildings, Clair / Sombre / Système…): the
 *   selected pill slides from the old option to the new one instead of jumping.
 */
@Injectable({ providedIn: 'root' })
export class AnimationsService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);

  constructor() {
    this.doc.addEventListener('click', (e) => this.onSegment(e), true);
  }

  private onSegment(e: Event): void {
    const button = (e.target as Element | null)?.closest?.('.tb-segmented > button') as HTMLElement | null;
    if (!button || !this.prefs.animate()) return;
    const group = button.parentElement!;
    const before = group.querySelector<HTMLElement>(':scope > button.tb-seg-on');
    if (!before || before === button) return;
    const start = this.rect(before, group);
    // After Angular has moved the selection (next frames)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const after = group.querySelector<HTMLElement>(':scope > button.tb-seg-on');
        if (!after || after === before) return;
        const arrival = this.rect(after, group);
        const style = getComputedStyle(after);
        const pill = this.doc.createElement('span');
        pill.className = 'tb-seg-pill';
        pill.setAttribute('aria-hidden', 'true');
        Object.assign(pill.style, {
          left: `${arrival.x}px`,
          top: `${arrival.y}px`,
          width: `${arrival.w}px`,
          height: `${arrival.h}px`,
          background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? style.backgroundImage : style.backgroundColor,
          boxShadow: style.boxShadow,
          borderRadius: style.borderRadius,
        });
        if (getComputedStyle(group).position === 'static') group.style.position = 'relative';
        group.prepend(pill);
        after.classList.add('tb-seg-slide');
        const sx = start.w / arrival.w;
        pill
          .animate(
            [
              { transform: `translate(${start.x - arrival.x + (start.w - arrival.w) / 2}px, ${start.y - arrival.y}px) scaleX(${sx})` },
              { transform: 'none' },
            ],
            { duration: 420, easing: 'cubic-bezier(.2, .9, .25, 1.1)' },
          )
          .finished.finally(() => {
            after.classList.remove('tb-seg-slide');
            pill.remove();
          });
      }),
    );
  }

  private rect(el: HTMLElement, inside: HTMLElement): { x: number; y: number; w: number; h: number } {
    const a = el.getBoundingClientRect();
    const b = inside.getBoundingClientRect();
    return { x: a.left - b.left - inside.clientLeft, y: a.top - b.top - inside.clientTop, w: a.width, h: a.height };
  }
}
