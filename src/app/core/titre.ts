import { Injectable, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/**
 * Title of the current page: in the browser tab ("Thermobox – Aperçu") and in the top bar of
 * phones once the page title has scrolled away (iOS, Android). Routes give it with `title`; a page
 * whose title depends on its data (a salle) sets it itself.
 */
@Injectable({ providedIn: 'root' })
export class TitreService {
  private readonly title = inject(Title);
  readonly titre = signal('');

  definir(titre: string): void {
    this.titre.set(titre);
    this.title.setTitle(titre ? `Thermobox – ${titre}` : 'Thermobox');
  }
}

@Injectable({ providedIn: 'root' })
export class TitreStrategie extends TitleStrategy {
  private readonly titres = inject(TitreService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.titres.definir(this.buildTitle(snapshot) ?? '');
  }
}
