import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { StyleSite } from '../models/models';
import { HomeColors } from './colors';

export type Theme = 'light' | 'dark';
/** What the user picked on the Preferences page: a theme, or the one of the system. */
export type ThemeChoice = Theme | 'auto';
export type Unit = 'C' | 'F';

interface Stored {
  theme?: ThemeChoice;
  tint?: boolean;
  unit?: Unit;
  keyboard?: boolean;
  /** Computers: the side bar folded into a rail of icons. */
  sidebarCollapsed?: boolean;
  homeColors?: HomeColors;
  tolerance?: number;
  cardSize?: number;
  buildingOrder?: string[];
}

const KEY = 'tb-preferences';

/**
 * Display preferences of this device (Preferences page, the only place they change): theme,
 * colours following the state, unit of the temperatures, keyboard shortcuts. Applied to <html> as
 * data-* attributes read by the stylesheets. The look chosen by an ADMIN for everyone ("panel")
 * comes from the server (SettingsService) and lands here too.
 *
 * Animations are not a setting: they follow the system (iOS « Réduire les animations », Android
 * « Supprimer les animations », the same setting on a computer), live.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly doc = inject(DOCUMENT);
  private readonly stored: Stored = read();

  private readonly darkQuery = matchMedia('(prefers-color-scheme: dark)');
  private readonly motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly systemDark = signal(this.darkQuery.matches);

  /** Theme picked; « auto » (the default) follows the system, also when it changes at night. */
  readonly themeChoice = signal<ThemeChoice>(this.stored.theme ?? 'auto');
  /** Theme shown. */
  readonly theme = computed<Theme>(() => {
    const c = this.themeChoice();
    return c === 'auto' ? (this.systemDark() ? 'dark' : 'light') : c;
  });
  readonly tint = signal(this.stored.tint ?? true);
  readonly unit = signal<Unit>(this.stored.unit ?? 'C');
  readonly keyboard = signal(this.stored.keyboard ?? true);
  /** Computers: the side bar shows the names of the pages, or only their icons. */
  readonly sidebarCollapsed = signal(this.stored.sidebarCollapsed ?? false);
  /** « Maison »: rooms coloured by their gap to the setpoint (default) or by their temperature. */
  readonly homeColors = signal<HomeColors>(this.stored.homeColors ?? 'delta');
  /** Degrees of gap that colour a room halfway (1 °C by default): the gap scales stretch with it. */
  readonly tolerance = signal(this.stored.tolerance ?? 1);
  /** Computers: size of the cards of the dashboard, 1 = as designed. */
  readonly cardSize = signal(this.stored.cardSize ?? 1);
  /** Order of the buildings on the dashboard, as arranged by hand (keys of its sections). */
  readonly buildingOrder = signal<string[]>(this.stored.buildingOrder ?? []);
  readonly style = signal<StyleSite>('glass');

  /** The system asks for less motion: no transitions between pages, nothing slides or pops. */
  readonly reducedMotion = signal(this.motionQuery.matches);
  readonly animate = computed(() => !this.reducedMotion());

  readonly fahrenheit = computed(() => this.unit() === 'F');

  constructor() {
    this.darkQuery.addEventListener('change', (e) => this.systemDark.set(e.matches));
    this.motionQuery.addEventListener('change', (e) => this.reducedMotion.set(e.matches));
    effect(() => {
      const root = this.doc.documentElement;
      root.dataset['theme'] = this.theme();
      root.dataset['motion'] = this.reducedMotion() ? 'off' : 'on';
      root.dataset['tint'] = this.tint() ? 'on' : 'off';
      root.dataset['style'] = this.style();
      root.dataset['unit'] = this.unit() === 'F' ? '°F' : '°C';
      root.dataset['sidebar'] = this.sidebarCollapsed() ? 'collapsed' : 'full';
      // The colour of the window / of the browser bars follows: WindowColorService
    });
    effect(() => {
      write({
        theme: this.themeChoice(),
        tint: this.tint(),
        unit: this.unit(),
        keyboard: this.keyboard(),
        sidebarCollapsed: this.sidebarCollapsed(),
        homeColors: this.homeColors(),
        tolerance: this.tolerance(),
        cardSize: this.cardSize(),
        buildingOrder: this.buildingOrder(),
      });
    });
  }

  /**
   * Picks a theme. When the shown theme changes, the new one spreads in a circle from [depuis]
   * (the button pressed), as in the JSF interface, where the browser supports view transitions.
   */
  changeTheme(choice: ThemeChoice, from?: HTMLElement): void {
    const before = this.theme();
    const after: Theme = choice === 'auto' ? (this.systemDark() ? 'dark' : 'light') : choice;
    const doc = this.doc as Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
    if (before === after || !from || !doc.startViewTransition || this.reducedMotion()) {
      this.themeChoice.set(choice);
      return;
    }
    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const root = this.doc.documentElement;
    root.style.setProperty('--tb-reveal-from', `circle(0px at ${x}px ${y}px)`);
    root.style.setProperty('--tb-reveal', `circle(${radius}px at ${x}px ${y}px)`);
    root.classList.add('tb-theme-switch');
    doc
      .startViewTransition(() => {
        this.themeChoice.set(choice);
        // The attribute must change inside the callback for the snapshot to see the new theme
        root.dataset['theme'] = after;
      })
      .finished.finally(() => root.classList.remove('tb-theme-switch'));
  }
}

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

function write(p: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private browsing */
  }
}
