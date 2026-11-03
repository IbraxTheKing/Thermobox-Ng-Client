import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiVersionService, ServerInfo } from '../core/api-version';
import { ServerService } from '../core/api.config';
import { AuthService } from '../core/auth';
import { TemperatureLimits, TemperatureRange } from '../models/models';
import { AlertChannelDto, AlertRuleDto, AlertChannelRequest, AlertRuleRequest } from '../models/models';

const V1_SETPOINT: TemperatureRange = { min: 5, max: 35 };
const V1_MEASUREMENT: TemperatureRange = { min: -50, max: 80 };
export const ABSOLUTE_LIMITS: TemperatureRange = { min: -100, max: 200 };

@Injectable({ providedIn: 'root' })
export class ServerFeaturesService {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(ApiVersionService);
  private readonly server = inject(ServerService);
  private readonly auth = inject(AuthService);

  private readonly api = computed(() => this.server.base() ? (this.versions.known()[this.server.base()] ?? null) : null);
  readonly base = computed(() => this.server.base());
  readonly v2 = computed(() => !!this.api()?.v2);
  readonly info = computed<ServerInfo | null>(() => this.api()?.info ?? null);
  readonly features = computed(() => new Set(this.info()?.features ?? []));

  /** Server capabilities */
  readonly people = computed(() => this.features().has('PEOPLE'));

  /** Server logo */
  readonly logo = computed(() =>
    this.v2()
      ? this.versions.logo(this.server.base(), 256) ?? null
      : null
  );

  readonly limits = signal<TemperatureLimits | null>(null);
  readonly setpointRange = computed(() => (this.v2() && this.limits()?.setpoint) || V1_SETPOINT);
  readonly measurementRange = computed(() => (this.v2() && this.limits()?.measurement) || V1_MEASUREMENT);

  readonly channels = signal<AlertChannelDto[]>([]);
  readonly rules = signal<AlertRuleDto[]>([]);

  constructor() {
    effect(() => { if (this.server.base()) void this.versions.api(this.server.base()); });
    
    const doc = inject(DOCUMENT);
    const icon = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const original = icon?.getAttribute('href') ?? null;
    effect(() => {
      if (!icon || !original) return;
      icon.removeAttribute('type');
      icon.href = this.v2() ? (this.versions.logo(this.server.base(), 64) ?? original) : original;
    });

    effect(() => {
      const v2 = this.v2();
      const user = this.auth.user();
      untracked(() => {
        this.limits.set(null);
        if (v2 && user) void this.loadLimits();
      });
    });
  }

  async loadLimits() {
    try { this.limits.set(await firstValueFrom(this.http.get<TemperatureLimits>(this.server.url('/server/limits')))); } catch {}
  }

  async loadAlerts() {
    try {
      const [ch, ru] = await Promise.all([
        firstValueFrom(this.http.get<AlertChannelDto[]>(this.server.url('/alerts/channels'))),
        firstValueFrom(this.http.get<AlertRuleDto[]>(this.server.url('/alerts/rules')))
      ]);
      this.channels.set(ch);
      this.rules.set(ru);
    } catch {}
  }

  async saveLimits(limits: Partial<TemperatureLimits>) {
    const r = await firstValueFrom(this.http.put<TemperatureLimits>(this.server.url('/server/limits'), limits));
    this.limits.set(r);
    return r;
  }

  async resetLimits() {
    const r = await firstValueFrom(this.http.delete<TemperatureLimits>(this.server.url('/server/limits')));
    this.limits.set(r);
    return r;
  }

  async setLogo(file: Blob) {
    const info = await firstValueFrom(this.http.put<ServerInfo>(this.server.url('/server/logo'), file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
    this.versions.update(this.server.base(), info);
  }

  async resetLogo() {
    const info = await firstValueFrom(this.http.delete<ServerInfo>(this.server.url('/server/logo')));
    this.versions.update(this.server.base(), info);
  }

  /** ADMIN — channels for temperature alerts. */
  async saveChannels(request: AlertChannelRequest): Promise<AlertChannelDto[]> {
    if (!request?.name) throw new Error("Nom du canal requis");
    const r = await firstValueFrom(this.http.put<AlertChannelDto[]>(this.server.url('/alerts/channels'), request));
    this.channels.set(r);
    return r;
  }

  /** ADMIN — rules for temperature alerts. */
  async saveRules(request: AlertRuleRequest): Promise<AlertRuleDto[]> {
    if (!request?.name) throw new Error("Nom de la règle requis");
    const r = await firstValueFrom(this.http.put<AlertRuleDto[]>(this.server.url('/alerts/rules'), request));
    this.rules.set(r);
    return r;
  }

  async deleteChannel(id: number): Promise<void> {
    if (await this.http.delete(`/${this.server.url('/alerts/channels')}/${id}`)) {
      this.channels.update(ch => ch.filter(c => c.id !== id));
    }
  }

  async deleteRule(id: number): Promise<void> {
    if (await this.http.delete(`/${this.server.url('/alerts/rules')}/${id}`)) {
      this.rules.update(r => r.filter(x => x.id !== id));
    }
  }
}
