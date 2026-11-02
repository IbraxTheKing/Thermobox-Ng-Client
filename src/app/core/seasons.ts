/**
 * The holidays of the year that change the look of the « Maison » style (SeasonService): when
 * each one starts and ends, its colour, and what falls (or rises, or drifts) across the page.
 *
 * To add one: a new entry in SEASONS, with its days and its look (seasons.css can add more under
 * html[data-season="<id>"]). The first season of the list that covers a day wins.
 */

/** What crosses the page during a season (TbSeasonDecor). */
export interface SeasonParticles {
  /** One or more shapes, SVG paths in a 24 × 24 box. */
  readonly shapes: readonly string[];
  readonly colors: readonly string[];
  /** fall: from the top, as snow; rise: from the bottom, as bubbles; drift: across the top. */
  readonly motion: 'fall' | 'rise' | 'drift';
  /** How many at once (a few: the page stays readable). */
  readonly count: number;
  /** Size in pixels, smallest and largest. */
  readonly size: readonly [number, number];
}

export interface Season {
  readonly id: string;
  /** For the Préférences page: « Noël », « Halloween »… */
  readonly label: string;
  /** Under the title of « Maison »: « Joyeux Noël »… */
  readonly greeting: string;
  /** First day of the season in [year] (local time, midnight). */
  readonly start: (year: number) => Date;
  /** Day after the last one (excluded). */
  readonly end: (year: number) => Date;
  /** Accent of the season (OKLCH hue and chroma), when the user kept the ThermoBox colours. */
  readonly accent: { readonly h: number; readonly c: number };
  readonly particles: SeasonParticles;
}

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date);

/** Easter Sunday of [year] (Gregorian calendar, anonymous algorithm of Meeus / Jones / Butcher). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return day(year, month, date);
}

const plus = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

// Shapes (24 × 24)
const SNOWFLAKE =
  'M11 2h2v4.6l2.3-1.4 1 1.7L13 9.1V11h1.9l2.2-3.3 1.7 1-1.4 2.3H22v2h-4.6l1.4 2.3-1.7 1-2.2-3.3H13v1.9l3.3 2.2-1 1.7-2.3-1.4V22h-2v-4.6l-2.3 1.4-1-1.7L11 14.9V13H9.1l-2.2 3.3-1.7-1L6.6 13H2v-2h4.6L5.2 8.7l1.7-1L9.1 11H11V9.1L7.7 6.9l1-1.7L11 6.6z';
const DOT = 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z';
const BAT =
  'M12 9c.7-1.4 1.6-2 2.4-2-.3.9-.2 1.7.3 2.3 1.6-1.6 4.2-2.1 7.3-1.3-1.7.8-2.8 2-3.1 3.6-1.3-.6-2.5-.4-3.4.6-.6-.6-1.4-.8-2.4-.6-1-.2-1.8 0-2.4.6-.9-1-2.1-1.2-3.4-.6C4.8 10.6 3.7 9.4 2 8.6c3.1-.8 5.7-.3 7.3 1.3.5-.6.6-1.4.3-2.3.8 0 1.7.6 2.4 1.4z';
const LEAF = 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15l-1-1zm2-1c3-3 6-6 9-9';
const EGG = 'M12 3c3.5 0 6.5 5.4 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.4 8.5 3 12 3z';
const HEART = 'M12 20.5 4.4 13A4.9 4.9 0 0 1 12 6.7a4.9 4.9 0 0 1 7.6 6.3z';
const STAR = 'M12 2.5l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.8l-5.8 3.5 1.6-6.6-5.2-4.4 6.8-.5z';
const CONFETTI = 'M9 4h6v16H9z';

export const SEASONS: readonly Season[] = [
  {
    id: 'new-year',
    label: $localize`Nouvel An`,
    greeting: $localize`Bonne année !`,
    start: (y) => day(y, 12, 31),
    end: (y) => day(y + 1, 1, 3),
    accent: { h: 85, c: 0.1 },
    particles: { shapes: [STAR, CONFETTI, DOT], colors: ['#e7b93a', '#f3d77c', '#c9a227', '#ffffff'], motion: 'fall', count: 22, size: [8, 16] },
  },
  {
    id: 'valentine',
    label: $localize`Saint-Valentin`,
    greeting: $localize`Bonne Saint-Valentin`,
    start: (y) => day(y, 2, 13),
    end: (y) => day(y, 2, 15),
    accent: { h: 5, c: 0.12 },
    particles: { shapes: [HEART], colors: ['#e5567a', '#f28aa5', '#c23b5d'], motion: 'rise', count: 14, size: [10, 20] },
  },
  {
    id: 'easter',
    label: $localize`Pâques`,
    greeting: $localize`Joyeuses Pâques`,
    // Good Friday to Easter Monday
    start: (y) => plus(easter(y), -2),
    end: (y) => plus(easter(y), 2),
    accent: { h: 145, c: 0.08 },
    particles: { shapes: [EGG], colors: ['#f6c6d8', '#bfe3c5', '#f9e3a1', '#c9d7f5', '#e3cdf3'], motion: 'fall', count: 14, size: [12, 22] },
  },
  {
    id: 'bastille-day',
    label: $localize`Fête nationale`,
    greeting: $localize`Bonne fête nationale`,
    start: (y) => day(y, 7, 13),
    end: (y) => day(y, 7, 15),
    accent: { h: 260, c: 0.11 },
    particles: { shapes: [CONFETTI, STAR], colors: ['#2f4fb4', '#ffffff', '#d8343f'], motion: 'fall', count: 22, size: [8, 14] },
  },
  {
    id: 'halloween',
    label: $localize`Halloween`,
    greeting: $localize`Joyeux Halloween`,
    start: (y) => day(y, 10, 25),
    end: (y) => day(y, 11, 2),
    accent: { h: 55, c: 0.14 },
    particles: { shapes: [BAT, LEAF], colors: ['#2b2233', '#e07b28', '#8b4fb8'], motion: 'drift', count: 10, size: [16, 28] },
  },
  {
    id: 'christmas',
    label: $localize`Noël`,
    greeting: $localize`Joyeux Noël`,
    start: (y) => day(y, 12, 1),
    end: (y) => day(y, 12, 27),
    accent: { h: 25, c: 0.12 },
    particles: { shapes: [SNOWFLAKE, DOT], colors: ['#ffffff', '#e8f1ff', '#d4e4f7'], motion: 'fall', count: 24, size: [6, 16] },
  },
];

/** The season of [date], null between them. A season over New Year counts in both years. */
export function seasonOf(date: Date, seasons: readonly Season[] = SEASONS): Season | null {
  const t = date.getTime();
  for (const s of seasons) {
    for (const y of [date.getFullYear() - 1, date.getFullYear()]) {
      if (t >= s.start(y).getTime() && t < s.end(y).getTime()) return s;
    }
  }
  return null;
}

/** The next season after [date] (Préférences: « prochain : Noël, le 1er décembre »). */
export function nextSeason(date: Date, seasons: readonly Season[] = SEASONS): { season: Season; start: Date } | null {
  let best: { season: Season; start: Date } | null = null;
  for (const s of seasons) {
    for (const y of [date.getFullYear(), date.getFullYear() + 1]) {
      const start = s.start(y);
      if (start.getTime() > date.getTime() && (!best || start < best.start)) best = { season: s, start };
    }
  }
  return best;
}
