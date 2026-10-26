import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { Curve, curve, inTarget, instants, step } from '../../core/curves';
import { full, clockTime, ddmmHHmm, parseDate, time, toField, toLocal } from '../../core/dates';
import { RoomState, stateOf, offSetpoint } from '../../core/state';
import { downloadFile } from '../../core/file';
import { ConfirmService, ToastService } from '../../core/messages';
import { PreferencesService } from '../../core/preferences';
import { normalize, byName } from '../../core/text';
import { UnitService, parseNumber } from '../../core/unit';
import { Node, TemperatureType } from '../../models/models';
import { TreeStore } from '../../services/tree.store';
import { CurveCache, freshness } from '../../core/curve-cache';
import { ClimateService } from '../../services/climate.service';
import { TemperatureService, TemperatureTyped } from '../../services/temperature.service';
import { ChartSeries, TbChart } from '../../ui/chart';
import { TbSheet } from '../../ui/sheet';

/** One curve: a room or a building, with its figures over the period (Celsius). */
interface Row {
  element: Node;
  path: string;
  /** Colour of its curve: --tb-series-<n> */
  color: number;
  current: number | null;
  min: number | null;
  max: number | null;
  average: number | null;
  setpoint: number | null;
  delta: number | null;
  inTarget: number | null;
  state: RoomState;
  curve: Curve;
}

type Sort = 'name' | 'current' | 'setpoint' | 'min' | 'max' | 'average' | 'target';

const NO_BUILDING = -1;

/**
 * Mesures (temperatures.xhtml): every room (or every building) on one chart over 24 h, 7 or 30
 * days, a table that compares them, and the raw history of every measure and setpoint.
 */
@Component({
  selector: 'tb-measurements',
  imports: [RouterLink, DecimalPipe, TbChart, TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './measurements.html',
})
export class MeasurementsPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly unit = inject(UnitService);
  /** « Maison »: the history of the house. */
  protected readonly home = computed(() => this.prefs.style() !== 'panel');
  private readonly prefs = inject(PreferencesService);
  private readonly store = inject(TreeStore);
  private readonly climate = inject(ClimateService);
  private readonly temperatures = inject(TemperatureService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly chart = viewChild(TbChart);

  protected readonly periodHours = signal(24);
  protected readonly byBuilding = signal(false);
  protected readonly buildingId = signal<number | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly instants = signal<number[]>([]);
  protected readonly loading = signal(false);
  private readonly cache = inject(CurveCache);
  protected readonly hidden = signal<Set<number>>(new Set());
  protected readonly sortState = signal<{ by: Sort; desc: boolean } | null>(null);

  protected readonly NO_BUILDING = NO_BUILDING;

  protected readonly buildings = computed(() => [...this.store.buildings()].sort(byName((b) => b.name)));
  protected readonly hasData = computed(() => this.rows().filter((l) => l.current != null));
  protected readonly hottest = computed(() => this.hasData().reduce<Row | null>((m, l) => (!m || l.current! > m.current! ? l : m), null));
  protected readonly coldest = computed(() => this.hasData().reduce<Row | null>((m, l) => (!m || l.current! < m.current! ? l : m), null));
  protected readonly overallAverage = computed(() => {
    const l = this.hasData();
    return l.length ? l.reduce((s, x) => s + x.current!, 0) / l.length : null;
  });
  protected readonly offSetpoint = computed(() => this.rows().filter((l) => offSetpoint(l.state)).length);

  protected readonly series = computed<ChartSeries[]>(() =>
    this.rows().map((l) => ({ label: l.element.name ?? '', color: `--tb-series-${l.color}`, values: l.curve.values })),
  );
  protected readonly labels = computed(() => {
    const format = this.periodHours() <= 24 ? clockTime : ddmmHHmm;
    return this.instants().map((t) => format(new Date(t)));
  });

  /** The table, sorted as asked (clicking a column title). */
  protected readonly sortedRows = computed(() => {
    const t = this.sortState();
    const l = this.rows().map((x, i) => ({ l: x, i }));
    if (!t) return l;
    const key = (x: Row): number | string | null =>
      t.by === 'name' ? normalize(x.element.name) : t.by === 'target' ? x.inTarget : x[t.by];
    return [...l].sort((a, b) => {
      const valueA = key(a.l);
      const valueB = key(b.l);
      if (valueA == null) return 1;
      if (valueB == null) return -1;
      const c = typeof valueA === 'string' ? valueA.localeCompare(valueB as string, 'fr') : (valueA as number) - (valueB as number);
      return t.desc ? -c : c;
    });
  });

  protected readonly stepText = computed(() => (this.periodHours() <= 24 ? "quart d'heure" : this.periodHours() <= 168 ? 'heure' : 'tranche de 4 h'));

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load(this.store.tree() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les salles', errorMessage(e));
    }
    await this.load();
  }

  protected async load(force = false): Promise<void> {
    // Kept in memory (CurveCache): the curves already read for these choices show at once, and
    // are read again only when no longer recent
    const key = `measurements|${this.byBuilding()}|${this.buildingId()}|${this.periodHours()}`;
    const kept = this.cache.read<{ rows: Row[]; instants: number[] }>(key);
    if (kept) {
      this.instants.set(kept.value.instants);
      this.rows.set(kept.value.rows);
      this.hidden.set(new Set());
      if (!force && kept.age < freshness(this.periodHours())) return;
    }
    this.loading.set(true);
    try {
      // A building's curve aggregates all its boxes: only for a user who may see all of it
      const elements = this.byBuilding()
        ? this.store.buildings().filter((b) => b.accessible).map((b) => ({ n: b, path: '' }))
        : this.store
            .rooms()
            .filter((s) => {
              const b = this.buildingId();
              const building = this.store.buildingOf(s.id);
              return b == null || (b === NO_BUILDING ? building == null : building?.id === b);
            })
            .map((s) => ({ n: s, path: this.store.pathText(s.id) }));
      elements.sort((a, b) => normalize(a.path).localeCompare(normalize(b.path), 'fr') || normalize(a.n.name).localeCompare(normalize(b.n.name), 'fr'));

      const end = new Date();
      end.setSeconds(0, 0);
      const start = new Date(end.getTime() - this.periodHours() * 3_600_000);
      const p = step(start.getTime(), end.getTime());
      const averages: Record<string, { date: string | null; value: number | null }[]> = {};
      for (let i = 0; i < elements.length; i += 200) {
        Object.assign(averages, await firstValueFrom(this.climate.averages(elements.slice(i, i + 200).map((e) => e.n.id), start, end)));
      }
      const rows = elements.map(({ n, path }, i): Row => {
        const points = (averages[String(n.id)] ?? []).filter((x) => x.value != null).map((x) => ({ t: time(x.date), v: x.value! }));
        const c = curve(points, start.getTime(), end.getTime(), p);
        const setpoint = n.setpoint?.value ?? null;
        return {
          element: n,
          path,
          color: (i % 8) + 1,
          current: n.temperature,
          min: c.min,
          max: c.max,
          average: c.average,
          setpoint,
          delta: n.temperature != null && setpoint != null ? n.temperature - setpoint : null,
          inTarget: inTarget(c, setpoint),
          state: stateOf(n.temperature, setpoint),
          curve: c,
        };
      });
      // The choices changed meanwhile: these curves are not the ones asked for any more
      if (key !== `measurements|${this.byBuilding()}|${this.buildingId()}|${this.periodHours()}`) return;
      const ins = instants(start.getTime(), end.getTime(), p);
      this.instants.set(ins);
      this.rows.set(rows);
      if (!kept) this.hidden.set(new Set());
      this.cache.write(key, { rows, instants: ins });
    } catch (e) {
      this.toasts.error('Impossible de charger les courbes', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    await this.store.load(true).catch(() => undefined);
    await this.load(true);
  }

  protected period(h: number): void {
    this.periodHours.set(h);
    void this.load();
  }

  protected group(byBuilding: boolean): void {
    this.byBuilding.set(byBuilding);
    void this.load();
  }

  protected chooseBuilding(v: string): void {
    this.buildingId.set(v === '' ? null : Number(v));
    void this.load();
  }

  protected sort(by: Sort): void {
    this.sortState.update((t) => (t?.by === by ? (t.desc ? null : { by, desc: true }) : { by, desc: false }));
  }

  protected sortIcon(by: Sort): string {
    const t = this.sortState();
    return t?.by !== by ? 'pi-sort-alt' : t.desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  }

  /** Colour chip of a row: shows or hides its curve. */
  protected toggleCurve(i: number): void {
    const visible = this.chart()?.toggle(i) ?? true;
    this.onToggle({ index: i, visible });
  }

  protected onToggle(e: { index: number; visible: boolean }): void {
    this.hidden.update((s) => {
      const r = new Set(s);
      if (e.visible) r.delete(e.index);
      else r.add(e.index);
      return r;
    });
  }

  protected highlight(i: number): void {
    this.chart()?.highlight(i);
  }

  /** Points of the chart: one line per moment, one column per curve (French spreadsheet format). */
  protected async exportCsv(): Promise<void> {
    const symbol = this.unit.symbol();
    const cell = (t: string) => `"${t.replace(/"/g, '""')}"`;
    const rows = [['Moment', ...this.rows().map((l) => `${l.element.name} (${symbol})`)].map(cell).join(';')];
    this.instants().forEach((t, k) => {
      rows.push(
        [
          cell(full(new Date(t))),
          ...this.rows().map((l) => {
            const v = l.curve.values[k];
            return v == null ? '' : String(Math.round(this.unit.fromCelsius(v) * 10) / 10).replace('.', ',');
          }),
        ].join(';'),
      );
    });
    await downloadFile('thermobox-temperatures.csv', '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ============================================================== raw history

  protected readonly rawOpen = signal(false);
  protected readonly rawLoaded = signal(false);
  protected readonly typeFilter = signal<TemperatureType | 'all'>('all');
  protected readonly raw = signal<TemperatureTyped[]>([]);
  protected readonly rawPageIndex = signal(0);
  protected readonly rawPages = computed(() => Math.max(1, Math.ceil(this.raw().length / 20)));
  protected readonly rawPage = computed(() => this.raw().slice(this.rawPageIndex() * 20, this.rawPageIndex() * 20 + 20));

  /** Read only once its section is opened (every temperature of the base). */
  protected onRaw(e: Event): void {
    const open = (e.target as HTMLDetailsElement).open;
    this.rawOpen.set(open);
    if (open && !this.rawLoaded()) void this.loadRaw();
  }

  protected filter(f: TemperatureType | 'all'): void {
    this.typeFilter.set(f);
    void this.loadRaw();
  }

  private async loadRaw(): Promise<void> {
    try {
      const l = await firstValueFrom(this.temperatures.getTyped(this.typeFilter()));
      this.raw.set(l.sort((a, b) => time(b.date) - time(a.date)));
      this.rawPageIndex.set(0);
      this.rawLoaded.set(true);
    } catch (e) {
      this.toasts.error("Impossible de charger l'historique", errorMessage(e));
    }
  }

  protected full = full;

  // Dialog (ADMIN)
  protected readonly editing = signal<TemperatureTyped | null>(null);
  protected readonly dialog = signal(false);
  protected readonly formType = signal<TemperatureType>('measurement');
  protected readonly formValue = signal('');
  protected readonly formDate = signal('');
  protected readonly formSubmitted = signal(false);

  protected create(): void {
    this.editing.set(null);
    this.formType.set('measurement');
    this.formValue.set('');
    this.formDate.set(toField(new Date()));
    this.formSubmitted.set(false);
    this.dialog.set(true);
  }

  protected edit(t: TemperatureTyped): void {
    this.editing.set(t);
    this.formType.set(t.type);
    this.formValue.set(t.value != null ? String(Math.round(this.unit.fromCelsius(t.value) * 10) / 10).replace('.', ',') : '');
    const d = parseDate(t.date);
    this.formDate.set(d ? toField(d) : '');
    this.formSubmitted.set(false);
    this.dialog.set(true);
  }

  protected readonly formError = computed(() => {
    const v = parseNumber(this.formValue());
    if (v == null) return 'Valeur obligatoire';
    if (v < this.unit.minValue() || v > this.unit.maxValue()) return `Entre ${this.unit.minValue()} et ${this.unit.maxValue()} ${this.unit.symbol()}`;
    if (!this.formDate()) return 'Date obligatoire';
    return null;
  });

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.formSubmitted.set(true);
    if (this.formError()) return;
    // Entered in the unit of the Preferences page, stored in Celsius
    const value = this.unit.inputToCelsius(parseNumber(this.formValue())!);
    const date = toLocal(new Date(this.formDate()));
    const t = this.editing();
    try {
      if (t?.id != null) {
        await firstValueFrom(this.temperatures.update(t.id, { value, date }));
        this.toasts.info('Température modifiée');
      } else {
        await firstValueFrom(this.temperatures.addTyped(this.formType(), value, date));
        this.toasts.info('Température ajoutée');
      }
      this.dialog.set(false);
      await this.loadRaw();
    } catch (err) {
      this.toasts.error('Enregistrement impossible', errorMessage(err));
    }
  }

  protected async remove(t: TemperatureTyped): Promise<void> {
    if (t.id == null) return;
    if (!(await this.confirm.ask('Supprimer', 'Supprimer cette température ?', { confirm: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.temperatures.remove(t.id));
      this.toasts.info('Température supprimée');
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
    }
    await this.loadRaw();
  }
}
