/**
 * Colours that follow the temperatures, for the two looks (tokens.css):
 *
 * - Panneau: the gap to the consigne on a continuous diverging scale, as a thermal camera: blue
 *   too cold, the enamel of the page when right, red too hot. A salle at its consigne does not
 *   draw the eye; one that drifts does, more as it drifts further.
 * - Maison: by default the gap to the consigne too, in the soft colours of a home: blue when the
 *   room is below what was asked, green when it is right, ochre then red above. Or, a choice of
 *   the Préférences page, the temperature itself, as a weather app (cool blue, soft green around
 *   20-21 °C, ochre, then red).
 *
 * The tolerance (Préférences, or the scale of the dashboard in Panneau) stretches the gap scales:
 * with 2°, a room 1° away is only half as coloured as with 1°.
 *
 * Celsius in, CSS colours out; the unit shown (°C / °F) does not change them.
 */

type Rgb = [number, number, number];

const ECART_CLAIR: [number, Rgb][] = [
  [-2.5, [47, 95, 174]],
  [-1.2, [169, 193, 226]],
  [-0.5, [183, 219, 193]],
  [0, [172, 213, 183]],
  [0.5, [183, 219, 193]],
  [1.2, [240, 180, 143]],
  [2.5, [201, 74, 53]],
];
const ECART_SOMBRE: [number, Rgb][] = [
  [-2.5, [70, 115, 196]],
  [-1.2, [43, 68, 103]],
  [-0.5, [34, 72, 52]],
  [0, [33, 80, 55]],
  [0.5, [34, 72, 52]],
  [1.2, [110, 64, 42]],
  [2.5, [200, 82, 60]],
];

export interface CouleurCase {
  fond: string;
  texte: string;
  /** Text of a lower contrast (path, gap). */
  doux: string;
}

/** Colour of a salle for its gap to the consigne (Celsius); null: not known. */
export function couleurEcart(ecartBrut: number | null, sombre: boolean, tolerance = 1): CouleurCase {
  const echelle = sombre ? ECART_SOMBRE : ECART_CLAIR;
  const ecart = ecartBrut == null ? null : ecartBrut / tolerance;
  if (ecart == null || isNaN(ecart)) {
    return sombre
      ? { fond: 'rgb(33, 39, 36)', texte: '#9aa49e', doux: '#7c8680' }
      : { fond: 'rgb(236, 238, 233)', texte: '#5d6862', doux: '#7c8680' };
  }
  const e = Math.max(echelle[0][0], Math.min(echelle[echelle.length - 1][0], ecart));
  let rgb: Rgb = echelle[0][1];
  for (let i = 1; i < echelle.length; i++) {
    const [a, ca] = echelle[i - 1];
    const [b, cb] = echelle[i];
    if (e <= b) {
      const t = (e - a) / (b - a);
      rgb = ca.map((v, j) => Math.round(v + (cb[j] - v) * t)) as Rgb;
      break;
    }
  }
  const clair = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150;
  return {
    fond: `rgb(${rgb.join(', ')})`,
    texte: clair ? '#1d2421' : '#ffffff',
    doux: clair ? 'rgba(29, 36, 33, .66)' : 'rgba(255, 255, 255, .78)',
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
export function couleurTemperature(t: number | null): string {
  if (t == null || isNaN(t)) return '#8a9690';
  return melange(TEMPERATURE, t);
}

const ECART_MAISON: [number, string][] = [
  [-2.5, '#3d6cb4'],
  [-1.2, '#2e8ca0'],
  [-0.5, '#3a8f78'],
  [0.5, '#4f9762'],
  [0.95, '#c08a3a'],
  [1.7, '#d0663f'],
  [2.5, '#c2413a'],
];

/** Maison: colour of a gap to the consigne (Celsius, stretched by the tolerance). */
export function couleurEcartMaison(ecart: number, tolerance = 1): string {
  return melange(ECART_MAISON, ecart / tolerance);
}

export type CouleursMaison = 'ecart' | 'temperature';

/**
 * Maison: the colour of a room, as the Préférences page asks. By gap, a room without consigne
 * falls back on its temperature.
 */
export function couleurPiece(temperature: number | null | undefined, consigne: number | null | undefined, mode: CouleursMaison, tolerance = 1): string {
  if (mode === 'ecart' && temperature != null && consigne != null) return couleurEcartMaison(temperature - consigne, tolerance);
  return couleurTemperature(temperature ?? null);
}

function melange(stops: [number, string][], x: number): string {
  const v = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], x));
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1];
    const [b, cb] = stops[i];
    if (v <= b) return `color-mix(in oklch, ${cb} ${Math.round(((v - a) / (b - a)) * 100)}%, ${ca})`;
  }
  return stops[stops.length - 1][1];
}

/** The same colour, softened into the page (tiles, background of a room's page). */
export function teinteDouce(couleur: string, sombre: boolean): string {
  return `color-mix(in oklch, ${couleur} ${sombre ? 30 : 24}%, var(--tb-fond))`;
}

/** The same colour, for text and lines on its soft tint. */
export function teinteForte(couleur: string, sombre: boolean): string {
  return sombre ? `color-mix(in oklch, ${couleur} 72%, #ffffff)` : `color-mix(in oklch, ${couleur} 78%, #1d2421)`;
}
