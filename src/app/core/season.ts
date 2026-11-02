import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { PreferencesService } from './preferences';
import { SEASONS, Season, nextSeason, seasonOf } from './seasons';

/**
 * Seasonal looks of the « Maison » style (seasons.ts): on the days of a holiday the app takes
 * its colour (when the user kept the ThermoBox colours: AccentService) and something crosses the
 * page behind the cards (TbSeasonDecor). Nothing in the « Panneau de configuration » style, nor
 * when the user turned it off (Préférences). Checked again at midnight and when the app comes back.
 *
 * html[data-season="<id>"] while one shows. ?season=<id> in the address shows one now (preview).
 */
@Injectable({ providedIn: 'root' })
export class SeasonService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);

  /** Today (the date only matters), refreshed at midnight. */
  private readonly today = signal(new Date());
  private readonly preview = SEASONS.find((s) => s.id === new URLSearchParams(location.search).get('season')) ?? null;
  private timer?: ReturnType<typeof setTimeout>;

  /** The holiday of today, whatever the style and the preference. */
  readonly ofToday = computed<Season | null>(() => this.preview ?? seasonOf(this.today()));
  /** The next one (Préférences). */
  readonly next = computed(() => nextSeason(this.today()));
  /** Only in « Maison », and when the user wants them. */
  readonly allowed = computed(() => this.prefs.style() !== 'panel' && this.prefs.seasons());
  /** The season shown now, null almost all the year. */
  readonly current = computed<Season | null>(() => (this.allowed() ? this.ofToday() : null));

  start(): void {
    effect(() => {
      const s = this.current();
      const root = this.doc.documentElement;
      if (s) root.dataset['season'] = s.id;
      else delete root.dataset['season'];
    });
    this.atMidnight();
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState !== 'visible') return;
      this.today.set(new Date());
      this.atMidnight();
    });
  }

  private atMidnight(): void {
    clearTimeout(this.timer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    this.timer = setTimeout(() => {
      this.today.set(new Date());
      this.atMidnight();
    }, midnight.getTime() - now.getTime());
  }
}
