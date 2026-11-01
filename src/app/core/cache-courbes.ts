import { Injectable } from '@angular/core';

import { surChangementDeCompte } from './auth';

interface Entree {
  valeur: unknown;
  /** When it was read from the server (ms). */
  lu: number;
}

/** Curves kept at most: a few periods of a few salles, the dashboard, the Mesures page. */
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
export class CacheCourbes {
  private readonly entrees = new Map<string, Entree>();

  constructor() {
    surChangementDeCompte(() => this.vider());
  }

  /** The curves under [cle], and how old they are (ms); null if not read yet. */
  lire<T>(cle: string): { valeur: T; age: number } | null {
    const e = this.entrees.get(cle);
    if (!e) return null;
    // Most recently used last: the first ones go when there are too many
    this.entrees.delete(cle);
    this.entrees.set(cle, e);
    return { valeur: e.valeur as T, age: Date.now() - e.lu };
  }

  ecrire<T>(cle: string, valeur: T): void {
    this.entrees.delete(cle);
    this.entrees.set(cle, { valeur, lu: Date.now() });
    while (this.entrees.size > MAXIMUM) this.entrees.delete(this.entrees.keys().next().value!);
  }

  /** What concerns an element changed (a consigne sent): its curves are read again. */
  oublier(prefixe: string): void {
    for (const cle of [...this.entrees.keys()]) if (cle.startsWith(prefixe)) this.entrees.delete(cle);
  }

  vider(): void {
    this.entrees.clear();
  }
}

/**
 * How long curves over [heures] stay fresh: the last measures move the end of a 24 h curve, much
 * less a 30-day one.
 */
export function fraicheur(heures: number): number {
  return heures <= 24 ? 2 * 60_000 : heures <= 168 ? 10 * 60_000 : 30 * 60_000;
}
