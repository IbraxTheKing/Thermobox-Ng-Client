import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServerService, errorMessage } from '../core/api.config';
import { onAccountChange } from '../core/auth';
import { DISCRETE } from '../core/http';
import {
  AlertChannel,
  AlertChannelRequest,
  AlertDelivery,
  AlertOverview,
  AlertRule,
  AlertRuleRequest,
} from '../models/models';

/** Seconds between two readings while the settings of the Serveur page are open. */
const EVERY = 30;

/**
 * The temperature alerts of the server (ADMIN, 26.12): channels (email, webhooks), rules, the
 * alerts in progress and the messages that could not be sent. Client of /api/v2/alerts.
 *
 * GET /api/v2/alerts gives everything at once; each change answers the channel or the rule as
 * saved, put in place here. A server without alerts (26.12 before them) answers 404: [available]
 * false, nothing shown. One with THERMOBOX_ALERTS=false still answers: status.enabled says so.
 */
@Injectable({ providedIn: 'root' })
export class AlertStore {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);

  readonly overview = signal<AlertOverview | null>(null);
  /** null: not known yet; false: the server has no alerts. */
  readonly available = signal<boolean | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly status = computed(() => this.overview()?.status ?? null);
  readonly channels = computed(() => this.overview()?.channels ?? []);
  readonly rules = computed(() => this.overview()?.rules ?? []);
  readonly active = computed(() => this.overview()?.active ?? []);
  readonly failed = computed(() => this.overview()?.failedDeliveries ?? []);

  private timer?: ReturnType<typeof setInterval>;
  private watchers = 0;

  constructor() {
    onAccountChange(() => {
      this.overview.set(null);
      this.available.set(null);
      this.error.set(null);
    });
  }

  private url(path = ''): string {
    return this.server.url(`/alerts${path}`);
  }

  /** Reads now, then every 30 s while watched ([stop] when the page closes). */
  watch(): void {
    if (this.watchers++ === 0) {
      void this.load();
      this.timer = setInterval(() => !document.hidden && this.available() && void this.load(true), EVERY * 1000);
    }
  }

  stop(): void {
    if (--this.watchers <= 0) {
      this.watchers = 0;
      clearInterval(this.timer);
    }
  }

  async load(discrete = false): Promise<void> {
    if (!discrete) this.loading.set(true);
    try {
      const o = await firstValueFrom(this.http.get<AlertOverview>(this.url(), { context: new HttpContext().set(DISCRETE, discrete) }));
      this.overview.set(o);
      this.available.set(true);
      this.error.set(null);
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 405)) this.available.set(false);
      else this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // ---------------------------------------------------------------- channels

  async createChannel(c: AlertChannelRequest): Promise<AlertChannel> {
    const r = await firstValueFrom(this.http.post<AlertChannel>(this.url('/channels'), c));
    this.put('channels', r);
    return r;
  }

  async updateChannel(id: number, c: AlertChannelRequest): Promise<AlertChannel> {
    const r = await firstValueFrom(this.http.put<AlertChannel>(this.url(`/channels/${id}`), c));
    this.put('channels', r);
    this.renameInRules(r);
    return r;
  }

  async enableChannel(id: number, enabled: boolean): Promise<AlertChannel> {
    const r = await firstValueFrom(this.http.put<AlertChannel>(this.url(`/channels/${id}/enabled`), { enabled }));
    this.put('channels', r);
    return r;
  }

  /** Also taken out of the rules (by the server). */
  async deleteChannel(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.url(`/channels/${id}`)));
    this.overview.update((o) =>
      o && {
        ...o,
        channels: o.channels.filter((c) => c.id !== id),
        rules: o.rules.map((r) => ({ ...r, channels: r.channels.filter((c) => c.id !== id) })),
      },
    );
  }

  /** A test message now: the delivery says SENT, or FAILED and why. */
  testChannel(id: number): Promise<AlertDelivery> {
    return firstValueFrom(this.http.post<AlertDelivery>(this.url(`/channels/${id}/test`), {}));
  }

  // ---------------------------------------------------------------- rules

  async createRule(r: AlertRuleRequest): Promise<AlertRule> {
    const saved = await firstValueFrom(this.http.post<AlertRule>(this.url('/rules'), r));
    this.put('rules', saved);
    return saved;
  }

  async updateRule(id: number, r: AlertRuleRequest): Promise<AlertRule> {
    const saved = await firstValueFrom(this.http.put<AlertRule>(this.url(`/rules/${id}`), r));
    this.put('rules', saved);
    return saved;
  }

  async enableRule(id: number, enabled: boolean): Promise<AlertRule> {
    const saved = await firstValueFrom(this.http.put<AlertRule>(this.url(`/rules/${id}/enabled`), { enabled }));
    this.put('rules', saved);
    return saved;
  }

  /** Its alerts in progress are cancelled (by the server). */
  async deleteRule(id: number): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.url(`/rules/${id}`)));
    this.overview.update((o) => o && { ...o, rules: o.rules.filter((r) => r.id !== id), active: o.active.filter((e) => e.ruleId !== id) });
  }

  // ----------------------------------------------------------------

  /** [item] in place of the one with its id, or added at the end. */
  private put<K extends 'channels' | 'rules'>(key: K, item: AlertOverview[K][number]): void {
    this.overview.update((o) => {
      if (!o) return o;
      const list = o[key] as { id: number }[];
      const i = list.findIndex((x) => x.id === item.id);
      const next = i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
      return { ...o, [key]: next };
    });
  }

  /** The rules show the channels by name. */
  private renameInRules(c: AlertChannel): void {
    this.overview.update((o) => o && { ...o, rules: o.rules.map((r) => ({ ...r, channels: r.channels.map((x) => (x.id === c.id ? { ...x, name: c.name } : x)) })) });
  }
}
