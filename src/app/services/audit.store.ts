import { HttpClient, HttpContext, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ServerService, errorMessage } from '../core/api.config';
import { onAccountChange } from '../core/auth';
import { DISCRETE } from '../core/http';
import { AuditFilter, AuditPage } from '../models/models';

/**
 * The log of the changes made through the API (ADMIN, ThermoBox 26.12): who changed what and
 * when. Client of /api/v2/audit. A server without it (before 26.12) answers 404: [available] false.
 */
@Injectable({ providedIn: 'root' })
export class AuditStore {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);

  readonly page = signal<AuditPage | null>(null);
  /** null: not known yet; false: the server keeps no log. */
  readonly available = signal<boolean | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** The users found in the log, for the filter. */
  readonly users = signal<{ id: number | null; username: string }[]>([]);
  /** Days the entries are kept; null: for good; undefined: not read yet. */
  readonly retention = signal<number | null | undefined>(undefined);

  private asked = 0;

  constructor() {
    onAccountChange(() => {
      this.page.set(null);
      this.available.set(null);
      this.users.set([]);
      this.retention.set(undefined);
    });
  }

  private url(path = ''): string {
    return this.server.url(`/audit${path}`);
  }

  /** The page [index] (from 0) of [size] entries matching [f]; the answers of older asks are dropped. */
  async load(f: AuditFilter, index: number, size: number, discrete = false): Promise<void> {
    const ask = ++this.asked;
    if (!discrete) this.loading.set(true);
    let params = new HttpParams().set('offset', index * size).set('limit', size);
    if (f.user != null) params = params.set('user', f.user);
    if (f.action) params = params.set('action', f.action);
    if (f.q.trim()) params = params.set('q', f.q.trim());
    if (f.days != null) params = params.set('from', new Date(Date.now() - f.days * 86_400_000).toISOString());
    try {
      const p = await firstValueFrom(this.http.get<AuditPage>(this.url(), { params, context: new HttpContext().set(DISCRETE, discrete) }));
      if (ask !== this.asked) return;
      this.page.set(p);
      this.available.set(true);
      this.error.set(null);
    } catch (e) {
      if (ask !== this.asked) return;
      if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 405)) this.available.set(false);
      else this.error.set(errorMessage(e));
    } finally {
      if (ask === this.asked) this.loading.set(false);
    }
  }

  async loadUsers(): Promise<void> {
    try {
      this.users.set(await firstValueFrom(this.http.get<{ id: number | null; username: string }[]>(this.url('/users'), { context: new HttpContext().set(DISCRETE, true) })));
    } catch {
      /* the filter without them */
    }
  }

  async loadRetention(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<{ retentionDays: number | null }>(this.url('/settings'), { context: new HttpContext().set(DISCRETE, true) }));
      this.retention.set(s.retentionDays ?? null);
    } catch {
      /* not shown */
    }
  }

  /** null: kept for good. */
  async setRetention(days: number | null): Promise<void> {
    const s = await firstValueFrom(this.http.put<{ retentionDays: number | null }>(this.url('/settings'), { retentionDays: days }));
    this.retention.set(s.retentionDays ?? null);
  }
}
