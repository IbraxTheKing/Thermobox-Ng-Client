import { TARGET_THRESHOLD } from './state';

/** A point of a curve: time in ms, value in Celsius. */
export interface PointT {
  t: number;
  v: number;
}

// ============================================================== Sparkline (dashboard cards)

/**
 * Small temperature curve of a dashboard card (Sparkline.kt of the JSF interface), drawn as SVG
 * paths in a 100 × 40 box stretched to the card. Overlays (last point, setpoint) in percent.
 */
export interface Sparkline {
  row: string;
  area: string;
  lastX: number;
  lastY: number;
  /** null without setpoint, or when it is so far from the curve that it would flatten it. */
  setpointY: number | null;
  /** Change over the last hour, null if the curve doesn't go back that far. */
  variation: number | null;
}

const WIDTH = 100;
const HEIGHT = 40;
const MARGIN = 4;
/** The period is cut in this many slots, each drawn as the average of its measures. */
const SLOTS = 48;
/** Smallest vertical range: below it, a few tenths of a degree would look like big swings. */
const DELTA_MIN = 1.5;
/** The setpoint stretches the scale only if it is this close to the curve. */
const SETPOINT_REACH = 3;

/** null when there are fewer than two slots with measures. */
export function sparkline(measurements: PointT[], start: number, end: number, setpoint: number | null): Sparkline | null {
  const duration = end - start;
  if (duration <= 0) return null;
  const bySlot = new Map<number, number[]>();
  for (const m of measurements) {
    if (m.t < start || m.t > end || isNaN(m.v)) continue;
    const c = Math.min(SLOTS - 1, Math.floor(((m.t - start) / duration) * SLOTS));
    const list = bySlot.get(c) ?? [];
    list.push(m.v);
    bySlot.set(c, list);
  }
  const points = [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, vs]) => [(c + 0.5) / SLOTS, vs.reduce((s, v) => s + v, 0) / vs.length] as const);
  if (points.length < 2) return null;

  let bottom = Math.min(...points.map((p) => p[1]));
  let top = Math.max(...points.map((p) => p[1]));
  const setpointVisible = setpoint != null && setpoint >= bottom - SETPOINT_REACH && setpoint <= top + SETPOINT_REACH ? setpoint : null;
  if (setpointVisible != null) {
    bottom = Math.min(bottom, setpointVisible);
    top = Math.max(top, setpointVisible);
  }
  if (top - bottom < DELTA_MIN) {
    const middle = (top + bottom) / 2;
    bottom = middle - DELTA_MIN / 2;
    top = middle + DELTA_MIN / 2;
  }
  const x = (p: number) => p * WIDTH;
  const y = (v: number) => MARGIN + ((top - v) / (top - bottom)) * (HEIGHT - 2 * MARGIN);
  const n = (v: number) => v.toFixed(2);

  const row = points.map(([p, v], i) => `${i === 0 ? 'M' : 'L'}${n(x(p))} ${n(y(v))}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${row} L${n(x(last[0]))} ${HEIGHT} L${n(x(first[0]))} ${HEIGHT} Z`;

  const oneHourAgo = last[0] - 3_600_000 / duration;
  const before = [...points].reverse().find((p) => p[0] <= oneHourAgo + 0.5 / SLOTS && p !== last);
  return {
    row,
    area,
    lastX: (x(last[0]) / WIDTH) * 100,
    lastY: (y(last[1]) / HEIGHT) * 100,
    setpointY: setpointVisible != null ? (y(setpointVisible) / HEIGHT) * 100 : null,
    variation: before ? last[1] - before[1] : null,
  };
}

/** pi-arrow-up-right, pi-arrow-down-right or pi-arrow-right */
export function variationIcon(v: number | null): string {
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
export interface Curve {
  values: (number | null)[];
  min: number | null;
  max: number | null;
  average: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Bucket length for a period: about 100 to 200 points whatever its length. */
export function step(start: number, end: number): number {
  const hours = (end - start) / HOUR;
  if (hours <= 6) return 5 * MINUTE;
  if (hours <= 48) return 15 * MINUTE;
  if (hours <= 24 * 8) return HOUR;
  if (hours <= 24 * 31) return 4 * HOUR;
  return 12 * HOUR;
}

/** Start of each bucket from [start] to [end]. */
export function instants(start: number, end: number, p: number): number[] {
  const r: number[] = [];
  for (let t = start; t < end; t += p) r.push(t);
  return r;
}

export function curve(points: PointT[], start: number, end: number, p: number): Curve {
  const n = instants(start, end, p).length;
  const sums = new Array<number>(n).fill(0);
  const numbers = new Array<number>(n).fill(0);
  const inside = points.filter((pt) => pt.t >= start && pt.t < end && !isNaN(pt.v));
  for (const pt of inside) {
    const i = Math.floor((pt.t - start) / p);
    if (i >= 0 && i < n) {
      sums[i] += pt.v;
      numbers[i]++;
    }
  }
  const values = sums.map((s, i) => (numbers[i] === 0 ? null : s / numbers[i]));
  const raw = inside.map((pt) => pt.v);
  return {
    values,
    min: raw.length ? Math.min(...raw) : null,
    max: raw.length ? Math.max(...raw) : null,
    average: raw.length ? raw.reduce((a, b) => a + b, 0) / raw.length : null,
  };
}

/** Share of the buckets (with a value) within half a degree of [setpoint], null without data. */
export function inTarget(c: Curve, setpoint: number | null): number | null {
  if (setpoint == null) return null;
  const known = c.values.filter((v): v is number => v != null);
  if (!known.length) return null;
  return known.filter((v) => Math.abs(v - setpoint) < TARGET_THRESHOLD).length / known.length;
}

// ============================================================== Chart series (history)

/**
 * Series on one common time axis, as ChartBuilder did: every date of any series is a label, and a
 * series repeats its last value where it has none (a setpoint holds until the next one).
 */
export function commonAxis(series: PointT[][]): { time: number[]; values: (number | null)[][] } {
  const time = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort((a, b) => a - b);
  const values = series.map((s) => {
    const byT = new Map(s.map((p) => [p.t, p.v] as const));
    let last: number | null = null;
    return time.map((t) => {
      const v = byT.get(t);
      if (v !== undefined) last = v;
      return last;
    });
  });
  return { time, values };
}

/**
 * Series ready for the chart, on one time axis. Up to [max] dates the points are kept as they are
 * (a series repeats its last value where it has none, as ChartBuilder did); beyond, the period is
 * cut into [max] equal slots, each the average of its points (the last one for a setpoint), so a
 * month of measures stays readable and fast.
 */
export function forChart(
  series: { points: PointT[]; steps?: boolean }[],
  max = 400,
): { time: number[]; values: (number | null)[][] } {
  const all = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  if (all.length <= max) return commonAxis(series.map((s) => s.points));
  const start = all[0];
  const end = all[all.length - 1] + 1;
  const width = (end - start) / max;
  const time = Array.from({ length: max }, (_, i) => Math.round(start + (i + 0.5) * width));
  const values = series.map((s) => {
    const sums = new Array<number>(max).fill(0);
    const numbers = new Array<number>(max).fill(0);
    const last = new Array<number | null>(max).fill(null);
    for (const p of s.points) {
      const i = Math.min(max - 1, Math.floor((p.t - start) / width));
      sums[i] += p.v;
      numbers[i]++;
      last[i] = p.v;
    }
    let report: number | null = null;
    return sums.map((sum, i) => {
      if (s.steps) {
        if (last[i] != null) report = last[i];
        return report;
      }
      return numbers[i] ? sum / numbers[i] : null;
    });
  });
  return { time, values };
}
