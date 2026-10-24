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

  private derniere: string | null = null;

  teinter(couleur: string | null): void {
    if (couleur === this.derniere) return;
    this.derniere = couleur;
    const fond = this.doc.querySelector<HTMLElement>('.tb-fond-page');
    if (fond) fond.style.backgroundColor = couleur ?? 'transparent';
    // The bars drawn outside the page (the native bar of Android) take it too: --tb-teinte-page,
    // and data-fond so they know when it changed
    const root = this.doc.documentElement;
    if (couleur) {
      root.style.setProperty('--tb-teinte-page', couleur);
      root.dataset['fond'] = couleur;
    } else {
      root.style.removeProperty('--tb-teinte-page');
      delete root.dataset['fond'];
    }
  }
}
