import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { ApiVersionService } from './api-version';
import { ServerService } from './api.config';
import { PreferencesService } from './preferences';

/** « Maison »: the words of a home for the same pages (as their headings). */
const HOME: Record<string, string> = { 'Aperçu': $localize`Maison`, 'Bâtiments et salles': $localize`Pièces`, 'Températures': $localize`Historique` };

/**
 * Title of the current page: in the browser tab ("Thermobox – Aperçu") and in the top bar of
 * phones once the page title has scrolled away (iOS, Android). Routes give it with `title`; a page
 * whose title depends on its data (a room) sets it itself.
 *
 * A server an ADMIN named (26.12): its name in place of « Thermobox » ("Siège social – Aperçu"),
 * in the tab, the title bar of the desktop apps and the notifications ([app]).
 */
@Injectable({ providedIn: 'root' })
export class TitleService {
  private readonly browserTitle = inject(Title);
  private readonly versions = inject(ApiVersionService);
  private readonly server = inject(ServerService);
  readonly title = signal('');
  /** The name of the current server, null without one. */
  readonly serverName = computed(() => this.versions.name(this.server.base()));
  /** What the window is called: the name of the server, else Thermobox. */
  readonly app = computed(() => this.serverName() ?? 'Thermobox');

  constructor() {
    effect(() => {
      const title = this.title();
      const app = this.app();
      this.browserTitle.setTitle(title ? `${app} – ${title}` : app);
    });
  }

  set(title: string): void {
    this.title.set(title);
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
