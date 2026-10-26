import { Injectable } from '@angular/core';

import { onAccountChange } from './auth';

interface CacheEntry {
  value: unknown;
  /** When it was read from the server (ms). */
  read: number;
}

/** Curves kept at most: a few periods of a few rooms, the dashboard, the Mesures page. */
const MAXIMUM = 40;

/**
 * Temperature curves already read, kept in memory while the app is open: coming back to a page
 * shows its curves at once, without asking the server again while they are recent (each page
 * says how recent: the curves of the last 24 h age faster than those of the last 30 days).
 * Older, they still show at once while the new ones load. Emptied when the account changes.
 *
 *   const h = cache.lire<Historique>(cle);         // { valeur, age } or null
 *   cache.ecrire(cle, historique);
 */
@Injectable({ providedIn: 'root' })
export class CurveCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor() {
    onAccountChange(() => this.clear());
  }

  /** The curves under [cle], and how old they are (ms); null if not read yet. */
  read<T>(key: string): { value: T; age: number } | null {
    const e = this.entries.get(key);
    if (!e) return null;
    // Most recently used last: the first ones go when there are too many
    this.entries.delete(key);
    this.entries.set(key, e);
    return { value: e.value as T, age: Date.now() - e.read };
  }

  write<T>(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, read: Date.now() });
    while (this.entries.size > MAXIMUM) this.entries.delete(this.entries.keys().next().value!);
  }

  /** What concerns an element changed (a setpoint sent): its curves are read again. */
  forget(prefix: string): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * How long curves over [heures] stay fresh: the last measures move the end of a 24 h curve, much
 * less a 30-day one.
 */
export function freshness(hours: number): number {
  return hours <= 24 ? 2 * 60_000 : hours <= 168 ? 10 * 60_000 : 30 * 60_000;
}
