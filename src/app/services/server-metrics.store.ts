import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServerService } from '../core/api.config';
import { onAccountChange } from '../core/auth';
import { DISCRETE } from '../core/http';
import { ServerMetrics } from '../models/models';

/** One reading of the server, with the time it was read and the GC pause since the previous one. */
export interface MetricsSample extends ServerMetrics {
  at: number;
  /** Milliseconds the server was paused by its garbage collector since the reading before. */
  gcPauseMs: number | null;
}

/** Seconds between two readings while the Serveur page is open. */
const EVERY = 3;
/** Readings kept: 10 minutes. */
const KEPT = (10 * 60) / EVERY;

/**
 * The resources of the server over the last minutes (ADMIN, 26.12): GET /api/v2/server/metrics
 * gives a reading of now; read every few seconds while the Serveur page is open (and not hidden),
 * kept here so the curves are still there when coming back to it. A server without the endpoint:
 * [available] false, nothing read again.
 */
@Injectable({ providedIn: 'root' })
export class ServerMetricsStore {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);

  readonly samples = signal<MetricsSample[]>([]);
  readonly last = computed(() => this.samples().at(-1) ?? null);
  /** null: not known yet; false: the server has no such endpoint (before 26.12, or not an ADMIN). */
  readonly available = signal<boolean | null>(null);
  readonly error = signal<string | null>(null);

  private timer?: ReturnType<typeof setInterval>;
  private watchers = 0;

  constructor() {
    onAccountChange(() => {
      this.samples.set([]);
      this.available.set(null);
    });
  }

  /** Starts reading (each open page calls it once and [stop] when it closes). */
  watch(): void {
    if (this.watchers++ === 0) {
      void this.read();
      this.timer = setInterval(() => !document.hidden && void this.read(), EVERY * 1000);
    }
  }

  stop(): void {
    if (--this.watchers <= 0) {
      this.watchers = 0;
      clearInterval(this.timer);
    }
  }

  private async read(): Promise<void> {
    if (this.available() === false) return;
    try {
      const m = await firstValueFrom(
        this.http.get<ServerMetrics>(this.server.url('/server/metrics'), { context: new HttpContext().set(DISCRETE, true) }),
      );
      const before = this.last();
      // Readings far apart (the page was closed): the curve starts again, no line across the gap
      const gap = before && Date.now() - before.at > EVERY * 4000;
      const sample: MetricsSample = {
        ...m,
        at: Date.now(),
        gcPauseMs: before && !gap && m.gcTimeMs >= before.gcTimeMs ? m.gcTimeMs - before.gcTimeMs : null,
      };
      this.samples.update((l) => [...(gap ? [] : l), sample].slice(-KEPT));
      this.available.set(true);
      this.error.set(null);
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 403)) {
        this.available.set(false);
        clearInterval(this.timer);
      } else {
        this.error.set('Le serveur ne répond pas');
      }
    }
  }
}
