import { Injectable, signal } from '@angular/core';

/**
 * Panel: the range of gaps to the setpoint picked on the scale of the dashboard (its two
 * handles). Kept while the session lasts, so that coming back from a room finds the same map;
 * null: no bound on that side.
 */
@Injectable({ providedIn: 'root' })
export class DeltaRange {
  readonly bottom = signal<number | null>(null);
  readonly top = signal<number | null>(null);
}
