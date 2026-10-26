import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * « Maison »: the page of a room takes the soft colour of its temperature. Drawn by a fixed layer
 * behind everything (.tb-background-page, in the shell): only that element's colour fades, nothing else
 * is restyled. Hidden in the panel style and without « Couleurs selon l'état » (tokens.css).
 */
@Injectable({ providedIn: 'root' })
export class BackgroundService {
  private readonly doc = inject(DOCUMENT);

  private last: string | null = null;

  tint(color: string | null): void {
    if (color === this.last) return;
    this.last = color;
    const background = this.doc.querySelector<HTMLElement>('.tb-background-page');
    if (background) background.style.backgroundColor = color ?? 'transparent';
    // The bars drawn outside the page (the native bar of Android) take it too: --tb-tint-page,
    // and data-background so they know when it changed
    const root = this.doc.documentElement;
    if (color) {
      root.style.setProperty('--tb-tint-page', color);
      root.dataset['background'] = color;
    } else {
      root.style.removeProperty('--tb-tint-page');
      delete root.dataset['background'];
    }
  }
}
