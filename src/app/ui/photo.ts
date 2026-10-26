import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { ImagesService } from '../services/images.service';

/** The photo of an element, fetched with the user's token (ImagesService). */
@Component({
  selector: 'tb-photo-img',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (src(); as s) {
      <img [src]="s" [alt]="alt()" decoding="async" />
    }
  `,
})
export class TbPhotoImg {
  private readonly images = inject(ImagesService);
  readonly roomId = input.required<number>();
  readonly version = input.required<number>();
  readonly alt = input('');
  protected readonly src = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.roomId();
      const v = this.version();
      void this.images.url(id, v).then((u) => {
        if (this.roomId() === id && this.version() === v) this.src.set(u);
      });
    });
  }
}
