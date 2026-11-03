import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import { ImagesService } from '../services/images.service';

/** A photo shown this soon after its frame was there is not new to the eye: no fade (ms). */
const AT_ONCE = 150;

/**
 * The photo of an element, fetched with the user's token (ImagesService). [fadeIn]: a photo that
 * arrives after its frame is shown fades in (.tb-photo-in); one there with its frame (already
 * read, or carried by the card that morphs into the page) does not, so it never blinks.
 */
@Component({
  selector: 'tb-photo-img',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (src(); as s) {
      <img [src]="s" [alt]="alt()" decoding="async" [class.tb-photo-wait]="fadeIn() && !ready()" [class.tb-photo-in]="fade()" (load)="loaded()" />
    }
  `,
})
export class TbPhotoImg {
  private readonly images = inject(ImagesService);
  readonly roomId = input.required<number>();
  readonly version = input.required<number>();
  readonly alt = input('');
  /** The photo of the page of a room: fades in when it arrives after its frame. */
  readonly fadeIn = input(false);
  protected readonly src = signal<string | null>(null);
  /** Loaded: shown (hidden until then, so a fade starts from nothing). */
  protected readonly ready = signal(false);
  protected readonly fade = signal(false);
  private shown = performance.now();

  constructor() {
    effect(() => {
      const id = this.roomId();
      const v = this.version();
      this.shown = performance.now();
      this.fade.set(false);
      this.ready.set(false);
      void this.images.url(id, v).then((u) => {
        if (this.roomId() === id && this.version() === v) this.src.set(u);
      });
    });
  }

  protected loaded(): void {
    const morphing = document.documentElement.classList.contains('tb-vt-in');
    if (this.fadeIn() && !morphing && performance.now() - this.shown > AT_ONCE) this.fade.set(true);
    this.ready.set(true);
  }
}
