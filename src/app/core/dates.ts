import { DateJson } from '../models/models';

/**
 * A date of the API as a JS Date (local time). Accepts what Jackson writes for a LocalDateTime
 * ([2026, 10, 21, 14, 5, 0, 123000000] or "2026-10-21T14:05:00.123") and ISO instants
 * ("2026-10-21T12:05:00Z").
 */
export function parseDate(v: DateJson | Date | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (Array.isArray(v)) {
    const [y, mo = 1, d = 1, h = 0, mi = 0, s = 0, nano = 0] = v;
    return new Date(y, mo - 1, d, h, mi, s, Math.floor(nano / 1e6));
  }
  // A LocalDateTime string has no zone: new Date() reads it as local time, which is what we want.
  const date = new Date(v);
  return isNaN(date.getTime()) ? null : date;
}

/** Milliseconds since the epoch, or NaN. */
export function temps(v: DateJson | Date | undefined): number {
  return parseDate(v)?.getTime() ?? NaN;
}

/** LocalDateTime for the API ("2026-10-21T14:05:00"), from a local Date. */
export function versLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Value of an <input type="datetime-local"> ("2026-10-21T14:05"). */
export function versChamp(d: Date): string {
  return versLocal(d).slice(0, 16);
}

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', o);
const JJ_MM = fmt({ day: '2-digit', month: '2-digit' });
const HH_MM = fmt({ hour: '2-digit', minute: '2-digit' });
const JJ_MM_AAAA = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });
const LONG = fmt({ day: 'numeric', month: 'long', year: 'numeric' });

/** « 21/10 14:05 » */
export function jjmmHHmm(v: DateJson | Date | undefined): string {
  const d = parseDate(v);
  return d ? `${JJ_MM.format(d)} ${HH_MM.format(d)}` : '';
}

/** « 21/10 à 14:05 » */
export function jjmmAHHmm(v: DateJson | Date | undefined): string {
  const d = parseDate(v);
  return d ? `${JJ_MM.format(d)} à ${HH_MM.format(d)}` : '';
}

/** « 21/10/2026 14:05 » */
export function complet(v: DateJson | Date | undefined): string {
  const d = parseDate(v);
  return d ? `${JJ_MM_AAAA.format(d)} ${HH_MM.format(d)}` : '';
}

/** « 21 octobre 2026 à 14:05 », « jamais » without a date. */
export function longue(v: DateJson | Date | undefined): string {
  const d = parseDate(v);
  return d ? `${LONG.format(d)} à ${HH_MM.format(d)}` : 'jamais';
}

/** « 14:05 » */
export function heure(v: DateJson | Date | undefined): string {
  const d = parseDate(v);
  return d ? HH_MM.format(d) : '';
}
