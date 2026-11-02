import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { StyleSite } from '../models/models';
import { DESKTOP_OS, TAURI } from './tauri';
import { LanguageChoice } from './i18n';
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
  /** 'default' (ThermoBox green), 'system' or the id of a palette (AccentService). */
  accent?: string;
  tolerance?: number;
  cardSize?: number;
  buildingOrder?: string[];
  /** Windows app: the Acrylic of the window and the blur of the bars. */
  windowBlur?: boolean;
  /** « Maison »: the look of the holidays of the year (SeasonService). */
  seasons?: boolean;
  /** Apps (mobile, desktop): notify when a room leaves or reaches its setpoint. */
  notifications?: boolean;
  /** Which rooms: the favorites or all those the user sees. */
  notifyRooms?: NotifyRooms;
  /** Language of the app (core/i18n.ts reads it before the app starts). */
  language?: LanguageChoice;
}

/** Rooms followed by the notifications of the setpoint. */
export type NotifyRooms = 'favorites' | 'all';

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
  /** Accent colour: the ThermoBox green, the system's, or a palette (AccentService applies it). */
  readonly accent = signal<string>(this.stored.accent ?? 'default');
  /** Windows app: Acrylic behind the side bar, blurred bars (on by default). */
  readonly windowBlur = signal(this.stored.windowBlur ?? true);
  /** « Maison »: Christmas, Halloween… change the look of the app on their days (on by default). */
  readonly seasons = signal(this.stored.seasons ?? true);
  /** Apps: notifications of the setpoint (off until the user turns them on). */
  readonly notifications = signal(this.stored.notifications ?? false);
  readonly notifyRooms = signal<NotifyRooms>(this.stored.notifyRooms ?? 'favorites');
  /** Language: the system's (French if it is French, English otherwise), or a chosen one. */
  readonly language = signal<LanguageChoice>(this.stored.language ?? 'auto');

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
      const json = JSON.stringify({
        theme: this.themeChoice(),
        tint: this.tint(),
        unit: this.unit(),
        keyboard: this.keyboard(),
        sidebarCollapsed: this.sidebarCollapsed(),
        homeColors: this.homeColors(),
        accent: this.accent(),
        tolerance: this.tolerance(),
        cardSize: this.cardSize(),
        buildingOrder: this.buildingOrder(),
        windowBlur: this.windowBlur(),
        seasons: this.seasons(),
        notifications: this.notifications(),
        notifyRooms: this.notifyRooms(),
        language: this.language(),
      } satisfies Stored);
      // Only what changed here: a reload from another window writes nothing back
      if (json === this.written) return;
      this.written = json;
      write(json);
      if (TAURI) void import('@tauri-apps/api/event').then((e) => e.emit('tb-preferences'));
    });
    // Another window of the app (the settings window of macOS), or another tab: applied here
    addEventListener('storage', (e) => e.key === KEY && this.reload());
    if (TAURI) void import('@tauri-apps/api/event').then((e) => e.listen('tb-preferences', () => this.reload()));
  }

  /** What was written last (or read at start): the stored text of these preferences. */
  private written = JSON.stringify(this.stored);

  /** The preferences as stored now, after another window changed them. */
  reload(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      return;
    }
    if (raw == null || raw === this.written) return;
    const p = read();
    this.written = raw;
    if (p.theme) this.themeChoice.set(p.theme);
    if (p.tint != null) this.tint.set(p.tint);
    if (p.unit) this.unit.set(p.unit);
    if (p.keyboard != null) this.keyboard.set(p.keyboard);
    if (p.sidebarCollapsed != null) this.sidebarCollapsed.set(p.sidebarCollapsed);
    if (p.homeColors) this.homeColors.set(p.homeColors);
    if (p.accent) this.accent.set(p.accent);
    if (p.tolerance != null) this.tolerance.set(p.tolerance);
    if (p.cardSize != null) this.cardSize.set(p.cardSize);
    if (p.buildingOrder) this.buildingOrder.set(p.buildingOrder);
    if (p.windowBlur != null) this.windowBlur.set(p.windowBlur);
    if (p.seasons != null) this.seasons.set(p.seasons);
    if (p.notifications != null) this.notifications.set(p.notifications);
    if (p.notifyRooms) this.notifyRooms.set(p.notifyRooms);
    // Another window changed the language: this one starts again in it
    if (p.language && p.language !== this.language()) location.reload();
  }

  /** Préférences › Langue: saved, then the app starts again in it (its texts load at start). */
  changeLanguage(choice: LanguageChoice): void {
    if (choice === this.language()) return;
    this.language.set(choice);
    // The effect writes on the next tick: written now, before the reload
    write(JSON.stringify({ ...read(), language: choice }));
    setTimeout(() => location.reload(), 50);
  }

  /**
   * Picks a theme. When the shown theme changes, the new one spreads in a circle from [depuis]
   * (the button pressed), as in the JSF interface, where the browser supports view transitions.
   */
  changeTheme(choice: ThemeChoice, from?: HTMLElement): void {
    const before = this.theme();
    const after: Theme = choice === 'auto' ? (this.systemDark() ? 'dark' : 'light') : choice;
    const doc = this.doc as Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
    // Windows app: the theme changes at once, as Windows does
    if (before === after || !from || !doc.startViewTransition || this.reducedMotion() || DESKTOP_OS === 'windows') {
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

function write(json: string): void {
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* private browsing */
  }
}
