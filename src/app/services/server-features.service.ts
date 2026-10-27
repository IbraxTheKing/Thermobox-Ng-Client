import { HttpClient } from '@angular/common/http';
import { DOCUMENT, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiVersionService, ServerInfo } from '../core/api-version';
import { ServerService } from '../core/api.config';
import { AuthService } from '../core/auth';
import { TemperatureLimits, TemperatureRange } from '../models/models';

/** Setpoints offered to a server before 26.12, which has no limits of its own to tell. */
const V1_SETPOINT: TemperatureRange = { min: 5, max: 35 };
/** Values typed by hand (a measurement added by an ADMIN) for a server before 26.12. */
const V1_MEASUREMENT: TemperatureRange = { min: -50, max: 80 };

/** Bounds an ADMIN may give to the limits (TemperatureLimits.ABSOLUTE of the server). */
export const ABSOLUTE_LIMITS: TemperatureRange = { min: -100, max: 200 };

/**
 * What the current server offers beyond the v1 API (26.12, API v2): its logo, and the
 * temperatures it accepts (setpoints and measurements), which an ADMIN chooses. A server before
 * 26.12 gets none of it: the dial and the steppers keep their former bounds (5 to 35 °C).
 *
 * Client of /api/v2/server (GET, logo, limits).
 */
@Injectable({ providedIn: 'root' })
export class ServerFeaturesService {
  private readonly http = inject(HttpClient);
  private readonly versions = inject(ApiVersionService);
  private readonly server = inject(ServerService);
  private readonly auth = inject(AuthService);

  private readonly api = computed(() => {
    const base = this.server.base();
    return base ? (this.versions.known()[base] ?? null) : null;
  });
  /** API base of the current server. */
  readonly base = computed(() => this.server.base());
  /** The server answers the v2 API (26.12 or later). */
  readonly v2 = computed(() => !!this.api()?.v2);
  /** Name, version, logo of the server (26.11 or later). */
  readonly info = computed<ServerInfo | null>(() => this.api()?.info ?? null);
  /** Its logo, null before 26.12. */
  readonly logo = computed(() => (this.v2() ? this.versions.logo(this.server.base(), 192) : null));

  /** What the server said (v2 only), null before it answered. */
  readonly limits = signal<TemperatureLimits | null>(null);
  readonly setpointRange = computed(() => (this.v2() && this.limits()?.setpoint) || V1_SETPOINT);
  readonly measurementRange = computed(() => (this.v2() && this.limits()?.measurement) || V1_MEASUREMENT);

  constructor() {
    // Which API, as soon as the server is known; then its limits, once logged in
    effect(() => {
      const base = this.server.base();
      if (base) void this.versions.api(base);
    });
    // The browser tab shows the logo of the server (26.12), else ThermoBox's
    const doc = inject(DOCUMENT);
    const icon = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const original = icon?.getAttribute('href') ?? null;
    effect(() => {
      const logo = this.v2() ? this.versions.logo(this.server.base(), 64) : null;
      if (!icon || !original) return;
      icon.removeAttribute('type');
      icon.href = logo ?? original;
    });
    effect(() => {
      const v2 = this.v2();
      const user = this.auth.user();
      this.server.base();
      untracked(() => {
        this.limits.set(null);
        if (v2 && user) void this.loadLimits();
      });
    });
  }

  async loadLimits(): Promise<void> {
    try {
      this.limits.set(await firstValueFrom(this.http.get<TemperatureLimits>(this.server.url('/server/limits'))));
    } catch {
      /* the bounds of v1 meanwhile */
    }
  }

  /** ADMIN — a missing part is kept. */
  async saveLimits(limits: Partial<TemperatureLimits>): Promise<TemperatureLimits> {
    const r = await firstValueFrom(this.http.put<TemperatureLimits>(this.server.url('/server/limits'), limits));
    this.limits.set(r);
    return r;
  }

  /** ADMIN — back to -10 to 50 °C. */
  async resetLimits(): Promise<TemperatureLimits> {
    const r = await firstValueFrom(this.http.delete<TemperatureLimits>(this.server.url('/server/limits')));
    this.limits.set(r);
    return r;
  }

  /** ADMIN — PNG, JPEG, GIF or SVG, 5 MB at most. */
  async setLogo(file: Blob): Promise<void> {
    const info = await firstValueFrom(
      this.http.put<ServerInfo>(this.server.url('/server/logo'), file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
    );
    this.versions.update(this.server.base(), info);
  }

  /** ADMIN — back to the logo of the website the server belongs to, else ThermoBox's. */
  async resetLogo(): Promise<void> {
    const info = await firstValueFrom(this.http.delete<ServerInfo>(this.server.url('/server/logo')));
    this.versions.update(this.server.base(), info);
  }
}
