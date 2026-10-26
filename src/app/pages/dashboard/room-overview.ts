import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Curve, curve, inTarget, instants, step } from '../../core/curves';
import { clockTime, ddmmAtHHmm, time } from '../../core/dates';
import { UnitService } from '../../core/unit';
import { ClimateService } from '../../services/climate.service';
import { ChartSeries, TbChart } from '../../ui/chart';
import { TbSheet } from '../../ui/sheet';
import { RoomSummary } from './summary';

const DAY = 24 * 3_600_000;

/**
 * A card of the dashboard held down: the whole last day of the room, larger, with what a glance
 * at the card does not say (lowest, highest, average, time spent at the setpoint, last hour,
 * boxes, last measure). A sheet on a phone, a window on a computer; « Ouvrir » goes to the room.
 *
 *   <tb-overview-room [r]="apercu()" (close)="overview.set(null)" (favorite)="toggleFavorite($event)" />
 */
@Component({
  selector: 'tb-overview-room',
  imports: [TbSheet, TbChart, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="open" [title]="current()?.room?.name ?? ''" [width]="760">
      @if (current(); as r) {
        <div class="tb-overview-room tb-tone-{{ r.state.tone }}">
          <p class="tb-overview-room-path">
            <span class="tb-tag tb-overview-room-state"><i class="tb-lamp" aria-hidden="true"></i>{{ r.state.label }}</span>
            @if (r.path) { <span>{{ r.path }}</span> }
          </p>

          <dl class="tb-overview-room-figures">
            <div><dt>Maintenant</dt><dd class="tb-figures">{{ unit.withSymbol(r.room.temperature) }}</dd></div>
            <div><dt>Objectif</dt><dd class="tb-figures">{{ r.room.setpoint?.value != null ? unit.withSymbol(r.room.setpoint?.value) : '—' }}</dd></div>
            <div><dt>Écart</dt><dd class="tb-figures">{{ r.delta != null ? unit.delta(r.delta) : '—' }}</dd></div>
            <div><dt>Sur une heure</dt><dd class="tb-figures">{{ r.trend?.variation != null ? unit.delta(r.trend!.variation) : '—' }}</dd></div>
          </dl>

          <div class="tb-chart tb-overview-room-curve">
            @if (chart(); as g) {
              <tb-chart-view [labels]="g.labels" [series]="g.series" [description]="'Dernières 24 heures de ' + r.room.name" />
            } @else if (loading()) {
              <div class="tb-overview-room-waiting" aria-busy="true"><i class="pi pi-spinner pi-spin"></i>Chargement des 24 dernières heures…</div>
            } @else {
              <div class="tb-overview-room-waiting">Pas de mesure ces dernières 24 heures.</div>
            }
          </div>

          <dl class="tb-overview-room-day">
            <div><dt>Plus bas (24 h)</dt><dd class="tb-figures">{{ unit.withSymbol(day()?.min) }}</dd></div>
            <div><dt>Plus haut (24 h)</dt><dd class="tb-figures">{{ unit.withSymbol(day()?.max) }}</dd></div>
            <div><dt>Moyenne (24 h)</dt><dd class="tb-figures">{{ unit.withSymbol(day()?.average) }}</dd></div>
            <div><dt>À l'objectif</dt><dd class="tb-figures">{{ target() != null ? percent(target()!) + ' du temps' : '—' }}</dd></div>
          </dl>

          <p class="tb-overview-room-foot">
            {{ r.room.devices }} {{ r.room.devices > 1 ? 'boîtiers' : 'boîtier' }}
            @if (r.room.lastMeasurement) { · dernière mesure {{ ddmmAtHHmm(r.room.lastMeasurement) }} }
          </p>

          <div class="tb-overview-room-actions">
            <button type="button" class="tb-btn tb-tonal" (click)="favorite.emit(r.room.id)">
              <i class="pi" [class.pi-star-fill]="r.room.favorite" [class.pi-star]="!r.room.favorite"></i>{{ r.room.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris' }}
            </button>
            <a class="tb-btn" [routerLink]="['/app/room', r.room.id]" (click)="open.set(false)"><i class="pi pi-arrow-right"></i>Ouvrir</a>
          </div>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbRoomOverview {
  protected readonly unit = inject(UnitService);
  private readonly climate = inject(ClimateService);

  readonly r = input<RoomSummary | null>(null);
  readonly close = output<void>();
  readonly favorite = output<number>();

  protected readonly open = signal(false);
  /** Kept while the sheet closes (the input is already null by then). */
  protected readonly current = signal<RoomSummary | null>(null);
  protected readonly loading = signal(false);
  private readonly dayCurve = signal<{ c: Curve; time: number[] } | null>(null);
  protected readonly ddmmAtHHmm = ddmmAtHHmm;

  constructor() {
    effect(() => {
      const r = this.r();
      untracked(() => {
        if (r) {
          // The same room refreshed (a favourite toggled…): the curve stays
          const other = this.current()?.room.id !== r.room.id;
          this.current.set(r);
          this.open.set(true);
          if (other) void this.load(r.room.id);
        }
      });
    });
    // Closed (cross, swipe, Escape, outside): the dashboard forgets it
    effect(() => {
      if (!this.open() && untracked(() => this.r())) this.close.emit();
    });
  }

  protected readonly day = computed(() => this.dayCurve()?.c ?? null);
  protected readonly target = computed(() => {
    const c = this.dayCurve()?.c;
    return c ? inTarget(c, this.current()?.room.setpoint?.value ?? null) : null;
  });

  protected readonly chart = computed(() => {
    const j = this.dayCurve();
    const r = this.current();
    if (!j || !r || !j.c.values.some((v) => v != null)) return null;
    const setpoint = r.room.setpoint?.value ?? null;
    const series: ChartSeries[] = [
      { label: 'Température', color: '--tb-series-average', role: 'average', values: j.c.values },
    ];
    if (setpoint != null) series.push({ label: 'Objectif', color: '--tb-series-setpoint', role: 'setpoint', values: j.c.values.map(() => setpoint) });
    return { labels: j.time.map((t) => clockTime(new Date(t))), series };
  });

  protected percent(x: number): string {
    return `${Math.round(x * 100)} %`;
  }

  private async load(id: number): Promise<void> {
    this.dayCurve.set(null);
    this.loading.set(true);
    const end = Date.now();
    const start = end - DAY;
    const p = step(start, end);
    try {
      const r = await firstValueFrom(this.climate.averages([id], new Date(start), new Date(end), true, 2 * instants(start, end, p).length));
      if (this.current()?.room.id !== id) return;
      const points = (r[String(id)] ?? []).filter((x) => x.value != null).map((x) => ({ t: time(x.date), v: x.value! }));
      this.dayCurve.set({ c: curve(points, start, end, p), time: instants(start, end, p) });
    } catch {
      /* the sheet says there is nothing to show */
    } finally {
      this.loading.set(false);
    }
  }
}
