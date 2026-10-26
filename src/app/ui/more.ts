import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, WritableSignal, effect, inject, input, output, signal } from '@angular/core';

/**
 * How many rows of a long list are drawn: [step] at first, [step] more each time the end of the
 * list comes near ([TbMore]). A ThermoBox can hold hundreds of rooms, devices or users: drawing
 * them all at once costs memory, time, and the curves of each card.
 *
 *   protected readonly shown = new ShownCount(50);
 *   @for (u of rows().slice(0, shown.count()); …)
 *   <tb-more [total]="rows().length" [shown]="shown.count()" (more)="shown.more()" />
 */
export class ShownCount {
  readonly count: WritableSignal<number>;

  constructor(private readonly step = 50) {
    this.count = signal(step);
  }

  more(): void {
    this.count.update((n) => n + this.step);
  }

  /** Back to the first rows (a search or a filter changed). */
  reset(): void {
    this.count.set(this.step);
  }
}

/**
 * The end of a list drawn a part at a time: the next part is drawn as it comes near (600 px
 * before it scrolls into view), or with the button (keyboard, screen readers, a page too short to
 * scroll). Nothing when everything is drawn.
 */
@Component({
  selector: 'tb-more',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-more', '[hidden]': 'shown() >= total()' },
  template: `
    @if (shown() < total()) {
      <button type="button" class="tb-btn tb-flat" (click)="more.emit()">
        <i class="pi pi-angle-down"></i>{{ label() }} ({{ total() - shown() }} de plus)
      </button>
    }
  `,
})
export class TbMore {
  readonly total = input.required<number>();
  readonly shown = input.required<number>();
  readonly label = input('Afficher la suite');
  readonly more = output<void>();

  private readonly near = signal(false);

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const observer = new IntersectionObserver((entries) => this.near.set(entries.some((e) => e.isIntersecting)), { rootMargin: '600px 0px' });
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
    // Near the end, and more to draw: the next part. Still near once it is drawn (a tall screen):
    // the observer is asked again, which answers at once
    effect(() => {
      if (!this.near() || this.shown() >= this.total()) return;
      queueMicrotask(() => {
        this.near.set(false);
        this.more.emit();
        observer.unobserve(host);
        requestAnimationFrame(() => observer.observe(host));
      });
    });
  }
}
