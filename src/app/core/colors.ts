/**
 * Colours that follow the temperatures, for the two looks (tokens.css):
 *
 * - Panel: the gap to the setpoint on a continuous diverging scale, as a thermal camera: blue
 *   too cold, the enamel of the page when right, red too hot. A room at its setpoint does not
 *   draw the eye; one that drifts does, more as it drifts further.
 * - Home: by default the gap to the setpoint too, in the soft colours of a home: blue when the
 *   room is below what was asked, green when it is right, ochre then red above. Or, a choice of
 *   the Preferences page, the temperature itself, as a weather app (cool blue, soft green around
 *   20-21 °C, ochre, then red).
 *
 * The tolerance (Preferences, or the scale of the dashboard in Panel) stretches the gap scales:
 * with 2°, a room 1° away is only half as coloured as with 1°.
 *
 * Celsius in, CSS colours out; the unit shown (°C / °F) does not change them.
 */

type Rgb = [number, number, number];

const DELTA_LIGHT: [number, Rgb][] = [
  [-2.5, [47, 95, 174]],
  [-1.2, [169, 193, 226]],
  [-0.5, [183, 219, 193]],
  [0, [172, 213, 183]],
  [0.5, [183, 219, 193]],
  [1.2, [240, 180, 143]],
  [2.5, [201, 74, 53]],
];
const DELTA_DARK: [number, Rgb][] = [
  [-2.5, [70, 115, 196]],
  [-1.2, [43, 68, 103]],
  [-0.5, [34, 72, 52]],
  [0, [33, 80, 55]],
  [0.5, [34, 72, 52]],
  [1.2, [110, 64, 42]],
  [2.5, [200, 82, 60]],
];

export interface CellColor {
  background: string;
  text: string;
  /** Text of a lower contrast (path, gap). */
  soft: string;
}

/** Colour of a room for its gap to the setpoint (Celsius); null: not known. */
export function deltaColor(rawDelta: number | null, dark: boolean, tolerance = 1): CellColor {
  const scale = dark ? DELTA_DARK : DELTA_LIGHT;
  const delta = rawDelta == null ? null : rawDelta / tolerance;
  if (delta == null || isNaN(delta)) {
    return dark
      ? { background: 'rgb(33, 39, 36)', text: '#9aa49e', soft: '#7c8680' }
      : { background: 'rgb(236, 238, 233)', text: '#5d6862', soft: '#7c8680' };
  }
  const e = Math.max(scale[0][0], Math.min(scale[scale.length - 1][0], delta));
  let rgb: Rgb = scale[0][1];
  for (let i = 1; i < scale.length; i++) {
    const [a, ca] = scale[i - 1];
    const [b, cb] = scale[i];
    if (e <= b) {
      const t = (e - a) / (b - a);
      rgb = ca.map((v, j) => Math.round(v + (cb[j] - v) * t)) as Rgb;
      break;
    }
  }
  const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150;
  return {
    background: `rgb(${rgb.join(', ')})`,
    text: light ? '#1d2421' : '#ffffff',
    soft: light ? 'rgba(29, 36, 33, .66)' : 'rgba(255, 255, 255, .78)',
  };
}

const TEMPERATURE: [number, string][] = [
  [16, '#3d6cb4'],
  [18.5, '#2e8ca0'],
  [20, '#3a8f78'],
  [21.8, '#5f9a57'],
  [23, '#c08a3a'],
  [24.5, '#d0663f'],
  [26, '#c2413a'],
];

/** Colour of a temperature itself (Celsius), mixed in OKLCH between its stops; null: grey. */
export function temperatureColor(t: number | null): string {
  if (t == null || isNaN(t)) return '#8a9690';
  return mix(TEMPERATURE, t);
}

const DELTA_HOME: [number, string][] = [
  [-2.5, '#3d6cb4'],
  [-1.2, '#2e8ca0'],
  [-0.5, '#3a8f78'],
  [0.5, '#4f9762'],
  [0.95, '#c08a3a'],
  [1.7, '#d0663f'],
  [2.5, '#c2413a'],
];

/** Home: colour of a gap to the setpoint (Celsius, stretched by the tolerance). */
export function homeDeltaColor(delta: number, tolerance = 1): string {
  return mix(DELTA_HOME, delta / tolerance);
}

export type HomeColors = 'delta' | 'temperature';

/**
 * Home: the colour of a room, as the Preferences page asks. By gap, a room without setpoint
 * falls back on its temperature.
 */
export function roomColor(temperature: number | null | undefined, setpoint: number | null | undefined, mode: HomeColors, tolerance = 1): string {
  if (mode === 'delta' && temperature != null && setpoint != null) return homeDeltaColor(temperature - setpoint, tolerance);
  return temperatureColor(temperature ?? null);
}

function mix(stops: [number, string][], x: number): string {
  const v = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], x));
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1];
    const [b, cb] = stops[i];
    if (v <= b) return `color-mix(in oklch, ${cb} ${Math.round(((v - a) / (b - a)) * 100)}%, ${ca})`;
  }
  return stops[stops.length - 1][1];
}

/** The same colour, softened into the page (tiles, background of a room's page). */
export function tintSoft(color: string, dark: boolean): string {
  return `color-mix(in oklch, ${color} ${dark ? 30 : 24}%, var(--tb-background))`;
}

/** The same colour, for text and lines on its soft tint. */
export function tintStrong(color: string, dark: boolean): string {
  return dark ? `color-mix(in oklch, ${color} 72%, #ffffff)` : `color-mix(in oklch, ${color} 78%, #1d2421)`;
}
