import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { SeasonService } from '../core/season';

/**
 * What crosses the page during a holiday (SeasonService, seasons.ts): snow at Christmas, bats at
 * Halloween, eggs at Easter… A few shapes behind the cards and the text (never over them, never
 * in the way of a click), slow; still when the system asks for less motion (seasons.css).
 */
@Component({
  selector: 'tb-season-decor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (particles(); as list) {
      <div class="tb-season" [class]="'tb-season tb-season-' + motion()" aria-hidden="true">
        @for (p of list; track $index) {
          <span class="tb-season-p" [style.--x]="p.x + '%'" [style.--y]="p.y + '%'" [style.--d]="p.duration + 's'" [style.--w]="p.delay + 's'">
            <svg viewBox="0 0 24 24" [style.width.px]="p.size" [style.height.px]="p.size" [style.color]="p.color" [style.rotate]="p.turn + 'deg'">
              <path [attr.d]="p.shape" fill="currentColor" />
            </svg>
          </span>
        }
      </div>
    }
  `,
})
export class TbSeasonDecor {
  private readonly seasons = inject(SeasonService);

  protected readonly motion = computed(() => this.seasons.current()?.particles.motion ?? 'fall');

  /** The same places every time for a season (a pseudo-random sequence, not Math.random). */
  protected readonly particles = computed(() => {
    const s = this.seasons.current();
    if (!s) return null;
    const p = s.particles;
    let seed = [...s.id].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    return Array.from({ length: p.count }, (_, i) => {
      const duration = p.motion === 'drift' ? 22 + rnd() * 18 : 14 + rnd() * 14;
      return {
        // Spread evenly across, a little jitter
        x: ((i + rnd()) / p.count) * 100,
        y: p.motion === 'drift' ? 4 + rnd() * 34 : rnd() * 100,
        size: p.size[0] + rnd() * (p.size[1] - p.size[0]),
        color: p.colors[Math.floor(rnd() * p.colors.length)],
        shape: p.shapes[Math.floor(rnd() * p.shapes.length)],
        turn: Math.round(rnd() * 360),
        duration: Math.round(duration * 10) / 10,
        // Already on their way when the page opens
        delay: -Math.round(rnd() * duration * 10) / 10,
      };
    });
  });
}
