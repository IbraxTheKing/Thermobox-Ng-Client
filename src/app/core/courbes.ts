import { SEUIL_CIBLE } from './etat';

/** A point of a curve: time in ms, value in Celsius. */
export interface PointT {
  t: number;
  v: number;
}

// ============================================================== Sparkline (dashboard cards)

/**
 * Small temperature curve of a dashboard card (Sparkline.kt of the JSF interface), drawn as SVG
 * paths in a 100 × 40 box stretched to the card. Overlays (last point, consigne) in percent.
 */
export interface Sparkline {
  ligne: string;
  aire: string;
  dernierX: number;
  dernierY: number;
  /** null without consigne, or when it is so far from the curve that it would flatten it. */
  consigneY: number | null;
  /** Change over the last hour, null if the curve doesn't go back that far. */
  variation: number | null;
}

const LARGEUR = 100;
const HAUTEUR = 40;
const MARGE = 4;
/** The period is cut in this many slots, each drawn as the average of its measures. */
const CRENEAUX = 48;
/** Smallest vertical range: below it, a few tenths of a degree would look like big swings. */
const ECART_MIN = 1.5;
/** The consigne stretches the scale only if it is this close to the curve. */
const PORTEE_CONSIGNE = 3;

/** null when there are fewer than two slots with measures. */
export function sparkline(mesures: PointT[], debut: number, fin: number, consigne: number | null): Sparkline | null {
  const duree = fin - debut;
  if (duree <= 0) return null;
  const parCreneau = new Map<number, number[]>();
  for (const m of mesures) {
    if (m.t < debut || m.t > fin || isNaN(m.v)) continue;
    const c = Math.min(CRENEAUX - 1, Math.floor(((m.t - debut) / duree) * CRENEAUX));
    const liste = parCreneau.get(c) ?? [];
    liste.push(m.v);
    parCreneau.set(c, liste);
  }
  const points = [...parCreneau.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, vs]) => [(c + 0.5) / CRENEAUX, vs.reduce((s, v) => s + v, 0) / vs.length] as const);
  if (points.length < 2) return null;

  let bas = Math.min(...points.map((p) => p[1]));
  let haut = Math.max(...points.map((p) => p[1]));
  const consigneVisible = consigne != null && consigne >= bas - PORTEE_CONSIGNE && consigne <= haut + PORTEE_CONSIGNE ? consigne : null;
  if (consigneVisible != null) {
    bas = Math.min(bas, consigneVisible);
    haut = Math.max(haut, consigneVisible);
  }
  if (haut - bas < ECART_MIN) {
    const milieu = (haut + bas) / 2;
    bas = milieu - ECART_MIN / 2;
    haut = milieu + ECART_MIN / 2;
  }
  const x = (p: number) => p * LARGEUR;
  const y = (v: number) => MARGE + ((haut - v) / (haut - bas)) * (HAUTEUR - 2 * MARGE);
  const n = (v: number) => v.toFixed(2);

  const ligne = points.map(([p, v], i) => `${i === 0 ? 'M' : 'L'}${n(x(p))} ${n(y(v))}`).join(' ');
  const premier = points[0];
  const dernier = points[points.length - 1];
  const aire = `${ligne} L${n(x(dernier[0]))} ${HAUTEUR} L${n(x(premier[0]))} ${HAUTEUR} Z`;

  const ilYAUneHeure = dernier[0] - 3_600_000 / duree;
  const avant = [...points].reverse().find((p) => p[0] <= ilYAUneHeure + 0.5 / CRENEAUX && p !== dernier);
  return {
    ligne,
    aire,
    dernierX: (x(dernier[0]) / LARGEUR) * 100,
    dernierY: (y(dernier[1]) / HAUTEUR) * 100,
    consigneY: consigneVisible != null ? (y(consigneVisible) / HAUTEUR) * 100 : null,
    variation: avant ? dernier[1] - avant[1] : null,
  };
}

/** pi-arrow-up-right, pi-arrow-down-right or pi-arrow-right */
export function iconeVariation(v: number | null): string {
  if (v == null) return '';
  if (v >= 0.2) return 'pi-arrow-up-right';
  if (v <= -0.2) return 'pi-arrow-down-right';
  return 'pi-arrow-right';
}

// ============================================================== Comparison (Mesures page)

/**
 * Several curves on one time axis (Comparaison.kt): the period is cut into equal buckets and each
 * curve gets the average of its points in each bucket, null where it has none.
 */
export interface Courbe {
  valeurs: (number | null)[];
  min: number | null;
  max: number | null;
  moyenne: number | null;
}

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/** Bucket length for a period: about 100 to 200 points whatever its length. */
export function pas(debut: number, fin: number): number {
  const heures = (fin - debut) / HEURE;
  if (heures <= 6) return 5 * MINUTE;
  if (heures <= 48) return 15 * MINUTE;
  if (heures <= 24 * 8) return HEURE;
  if (heures <= 24 * 31) return 4 * HEURE;
  return 12 * HEURE;
}

/** Start of each bucket from [debut] to [fin]. */
export function instants(debut: number, fin: number, p: number): number[] {
  const r: number[] = [];
  for (let t = debut; t < fin; t += p) r.push(t);
  return r;
}

export function courbe(points: PointT[], debut: number, fin: number, p: number): Courbe {
  const n = instants(debut, fin, p).length;
  const sommes = new Array<number>(n).fill(0);
  const nombres = new Array<number>(n).fill(0);
  const dans = points.filter((pt) => pt.t >= debut && pt.t < fin && !isNaN(pt.v));
  for (const pt of dans) {
    const i = Math.floor((pt.t - debut) / p);
    if (i >= 0 && i < n) {
      sommes[i] += pt.v;
      nombres[i]++;
    }
  }
  const valeurs = sommes.map((s, i) => (nombres[i] === 0 ? null : s / nombres[i]));
  const brutes = dans.map((pt) => pt.v);
  return {
    valeurs,
    min: brutes.length ? Math.min(...brutes) : null,
    max: brutes.length ? Math.max(...brutes) : null,
    moyenne: brutes.length ? brutes.reduce((a, b) => a + b, 0) / brutes.length : null,
  };
}

/** Share of the buckets (with a value) within half a degree of [consigne], null without data. */
export function dansLaCible(c: Courbe, consigne: number | null): number | null {
  if (consigne == null) return null;
  const connues = c.valeurs.filter((v): v is number => v != null);
  if (!connues.length) return null;
  return connues.filter((v) => Math.abs(v - consigne) < SEUIL_CIBLE).length / connues.length;
}

// ============================================================== Chart series (history)

/**
 * Series on one common time axis, as ChartBuilder did: every date of any series is a label, and a
 * series repeats its last value where it has none (a consigne holds until the next one).
 */
export function axeCommun(series: PointT[][]): { temps: number[]; valeurs: (number | null)[][] } {
  const temps = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort((a, b) => a - b);
  const valeurs = series.map((s) => {
    const parT = new Map(s.map((p) => [p.t, p.v] as const));
    let dernier: number | null = null;
    return temps.map((t) => {
      const v = parT.get(t);
      if (v !== undefined) dernier = v;
      return dernier;
    });
  });
  return { temps, valeurs };
}

/**
 * Series ready for the chart, on one time axis. Up to [max] dates the points are kept as they are
 * (a series repeats its last value where it has none, as ChartBuilder did); beyond, the period is
 * cut into [max] equal slots, each the average of its points (the last one for a consigne), so a
 * month of measures stays readable and fast.
 */
export function pourGraphique(
  series: { points: PointT[]; marches?: boolean }[],
  max = 400,
): { temps: number[]; valeurs: (number | null)[][] } {
  const tous = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  if (tous.length <= max) return axeCommun(series.map((s) => s.points));
  const debut = tous[0];
  const fin = tous[tous.length - 1] + 1;
  const largeur = (fin - debut) / max;
  const temps = Array.from({ length: max }, (_, i) => Math.round(debut + (i + 0.5) * largeur));
  const valeurs = series.map((s) => {
    const sommes = new Array<number>(max).fill(0);
    const nombres = new Array<number>(max).fill(0);
    const derniers = new Array<number | null>(max).fill(null);
    for (const p of s.points) {
      const i = Math.min(max - 1, Math.floor((p.t - debut) / largeur));
      sommes[i] += p.v;
      nombres[i]++;
      derniers[i] = p.v;
    }
    let report: number | null = null;
    return sommes.map((somme, i) => {
      if (s.marches) {
        if (derniers[i] != null) report = derniers[i];
        return report;
      }
      return nombres[i] ? somme / nombres[i] : null;
    });
  });
  return { temps, valeurs };
}
