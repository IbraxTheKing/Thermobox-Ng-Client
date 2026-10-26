import { Injectable, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { PreferencesService } from './preferences';

/** « Maison »: the words of a home for the same pages (as their headings). */
const HOME: Record<string, string> = { 'Aperçu': 'Maison', 'Bâtiments et salles': 'Pièces', 'Températures': 'Historique' };

/**
 * Title of the current page: in the browser tab ("Thermobox – Aperçu") and in the top bar of
 * phones once the page title has scrolled away (iOS, Android). Routes give it with `title`; a page
 * whose title depends on its data (a room) sets it itself.
 */
@Injectable({ providedIn: 'root' })
export class TitleService {
  private readonly browserTitle = inject(Title);
  readonly title = signal('');

  set(title: string): void {
    this.title.set(title);
    this.browserTitle.setTitle(title ? `Thermobox – ${title}` : 'Thermobox');
  }
}

@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly titles = inject(TitleService);
  private readonly prefs = inject(PreferencesService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot) ?? '';
    this.titles.set(this.prefs.style() !== 'panel' ? (HOME[title] ?? title) : title);
  }
}
