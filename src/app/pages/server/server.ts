import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';

import { UnitService } from '../../core/unit';
import { UpdateNoticeService } from '../../core/update-notice';
import { ServerFeaturesService } from '../../services/server-features.service';
import { MetricsSample, ServerMetricsStore } from '../../services/server-metrics.store';
import { ChartSeries, TbChart } from '../../ui/chart';
import { TbServerLogo } from '../../ui/server-logo';
import { UpdatesPage } from '../updates/updates';
import { ServerSettings } from './server-settings';
import { TbStyleSetting } from './style-setting';

type Tab = 'resources' | 'updates' | 'settings';

/**
 * Serveur (ADMIN): the ThermoBox server itself. Its resources (processor, memory, threads, pauses
 * of the garbage collector) over the last minutes, its updates, and its settings (temperatures
 * accepted, logo). Resources and settings come with 26.12 (API v2); an older server has its
 * updates only.
 */
@Component({
  selector: 'tb-server-page',
  imports: [NgTemplateOutlet, TbChart, TbServerLogo, UpdatesPage, ServerSettings, TbStyleSetting],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server.html',
})
export class ServerPage implements OnDestroy {
  protected readonly features = inject(ServerFeaturesService);
  protected readonly metrics = inject(ServerMetricsStore);
  protected readonly notice = inject(UpdateNoticeService);
  protected readonly unit = inject(UnitService);
  private readonly router = inject(Router);

  /** ?tab= of the address. */
  readonly tab = input<string | undefined>();
  protected readonly current = computed<Tab>(() => {
    const t = this.tab();
    if (t === 'updates' || t === 'settings' || t === 'resources') return t;
    return this.features.v2() ? 'resources' : 'updates';
  });

  constructor() {
    // The readings go on while the resources are shown, and stop when they are not
    let watching = false;
    effect(() => {
      const want = this.current() === 'resources' && this.features.v2();
      untracked(() => {
        if (want && !watching) this.metrics.watch();
        if (!want && watching) this.metrics.stop();
        watching = want;
      });
    });
    this.stopWatching = () => watching && this.metrics.stop();
  }

  private readonly stopWatching: () => void;

  ngOnDestroy(): void {
    this.stopWatching();
  }

  protected open(t: Tab): void {
    void this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true });
  }

  // ---------------------------------------------------------------- resources

  protected readonly labels = computed(() => this.metrics.samples().map((s) => clock(s.at)));

  private series(pick: (s: MetricsSample) => number | null, label: string, color: string, role?: 'average'): ChartSeries {
    return { label, color, values: this.metrics.samples().map(pick), role };
  }

  protected readonly cpu = computed<ChartSeries[]>(() => [
    this.series((s) => s.processCpu, 'Serveur ThermoBox', '--tb-series-1', 'average'),
    this.series((s) => s.systemCpu, 'Machine entière', '--tb-series-3'),
  ]);
  protected readonly memory = computed<ChartSeries[]>(() => {
    const l: ChartSeries[] = [
      this.series((s) => s.heapUsedMb, 'Utilisée', '--tb-series-2', 'average'),
      this.series((s) => s.heapCommittedMb, 'Réservée', '--tb-series-4'),
    ];
    if ((this.metrics.last()?.heapMaxMb ?? -1) > 0) l.push({ ...this.series((s) => s.heapMaxMb, 'Maximum', '--tb-series-setpoint'), role: 'setpoint' });
    return l;
  });
  protected readonly threads = computed<ChartSeries[]>(() => [this.series((s) => s.threads, 'Threads', '--tb-series-5', 'average')]);
  protected readonly gc = computed<ChartSeries[]>(() => [this.series((s) => s.gcPauseMs, 'Pauses', '--tb-series-6', 'average')]);

  /** GC pauses over the curves shown, in ms. */
  protected readonly gcTotal = computed(() => this.metrics.samples().reduce((n, s) => n + (s.gcPauseMs ?? 0), 0));
  protected readonly heapPercent = computed(() => {
    const m = this.metrics.last();
    return m && m.heapMaxMb > 0 ? Math.round((m.heapUsedMb / m.heapMaxMb) * 100) : null;
  });

  protected number(v: number | null | undefined, digits = 0): string {
    return v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** « 3 j 4 h », « 2 h 05 », « 12 min ». */
  protected uptime(s: number | null | undefined): string {
    if (s == null) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d} j ${h} h`;
    if (h) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min`;
  }
}

function clock(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
