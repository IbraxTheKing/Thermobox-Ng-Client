import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * « Maison »: the page of a room takes the soft colour of its temperature. Drawn by a fixed layer
 * behind everything (.tb-fond-page, in the shell): only that element's colour fades, nothing else
 * is restyled. Hidden in the panel style and without « Couleurs selon l'état » (tokens.css).
 */
@Injectable({ providedIn: 'root' })
export class FondService {
  private readonly doc = inject(DOCUMENT);

  teinter(couleur: string | null): void {
    const fond = this.doc.querySelector<HTMLElement>('.tb-fond-page');
    if (fond) fond.style.backgroundColor = couleur ?? 'transparent';
  }
}
