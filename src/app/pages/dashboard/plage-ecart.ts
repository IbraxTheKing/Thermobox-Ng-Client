import { Injectable, signal } from '@angular/core';

/**
 * Panneau: the range of gaps to the consigne picked on the scale of the dashboard (its two
 * handles). Kept while the session lasts, so that coming back from a salle finds the same map;
 * null: no bound on that side.
 */
@Injectable({ providedIn: 'root' })
export class PlageEcart {
  readonly bas = signal<number | null>(null);
  readonly haut = signal<number | null>(null);
}
