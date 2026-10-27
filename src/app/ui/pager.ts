import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/**
 * Pages of a long list: ‹ 1 2 … 6 7 8 … 25 › (the first, the last, those around the current).
 * Nothing when everything fits on one page.
 *
 *   <tb-pager [total]="rows().length" [size]="20" [(page)]="page" />
 */
@Component({
  selector: 'tb-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-pager', '[hidden]': 'count() <= 1' },
  template: `
    @if (count() > 1) {
      <nav class="tb-pagination" aria-label="Pages">
        <button type="button" [disabled]="page() === 0" (click)="go(page() - 1)" aria-label="Page précédente"><i class="pi pi-angle-left"></i></button>
        @for (p of numbers(); track $index) {
          @if (p < 0) {
            <span class="tb-pager-gap" aria-hidden="true">…</span>
          } @else {
            <button type="button" class="tb-pager-n" [class.tb-page-on]="p === page()" [attr.aria-current]="p === page() ? 'page' : null" (click)="go(p)">{{ p + 1 }}</button>
          }
        }
        <button type="button" [disabled]="page() >= count() - 1" (click)="go(page() + 1)" aria-label="Page suivante"><i class="pi pi-angle-right"></i></button>
      </nav>
    }
  `,
})
export class TbPager {
  readonly total = input.required<number>();
  readonly size = input(20);
  /** From 0. */
  readonly page = model(0);

  protected readonly count = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));

  /** Page numbers to show, -1 for a gap. */
  protected readonly numbers = computed(() => {
    const n = this.count();
    const p = Math.min(this.page(), n - 1);
    const keep = new Set([0, n - 1, p - 1, p, p + 1].filter((x) => x >= 0 && x < n));
    // Near an end: a few more on that side, the row keeps its length
    if (p <= 2) [1, 2, 3].forEach((x) => x < n && keep.add(x));
    if (p >= n - 3) [n - 2, n - 3, n - 4].forEach((x) => x >= 0 && keep.add(x));
    const sorted = [...keep].sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((x, i) => {
      if (i > 0 && x - sorted[i - 1] > 1) out.push(-1);
      out.push(x);
    });
    return out;
  });

  protected go(p: number): void {
    this.page.set(Math.max(0, Math.min(this.count() - 1, p)));
  }
}
