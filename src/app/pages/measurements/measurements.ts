import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
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
import { ShownCount, TbMore } from '../../ui/more';
import { RawFeed } from './raw-feed';

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
  /** null until read (rows not shown yet are not read). */
  curve: Curve | null;
}

/** The curves of one choice: its period, and those read so far. */
interface Curves {
  key: string;
  start: number;
  end: number;
  instants: number[];
  byId: Map<number, Curve>;
  /** Read for this period (the others are kept from before, shown until read again). */
  fresh: Set<number>;
}

/** Lines of a page of the raw history. */
const RAW_PAGE = 20;

/** Rows shown (and curves read) at a time. */
const ROWS = 24;

/** No curve read yet for [key], over the [hours] ending now. Those of [kept] stay meanwhile. */
function emptyCurves(key: string, hours = 24, kept?: Curves): Curves {
  const end = new Date();
  end.setSeconds(0, 0);
  const start = end.getTime() - hours * 3_600_000;
  const p = step(start, end.getTime());
  return { key, start, end: end.getTime(), instants: kept?.instants ?? instants(start, end.getTime(), p), byId: kept?.byId ?? new Map(), fresh: new Set() };
}

type Sort = 'name' | 'current' | 'setpoint' | 'min' | 'max' | 'average' | 'target';

const NO_BUILDING = -1;

/**
 * Mesures (temperatures.xhtml): every room (or every building) on one chart over 24 h, 7 or 30
 * days, a table that compares them, and the raw history of every measure and setpoint.
 */
@Component({
  selector: 'tb-measurements',
  imports: [RouterLink, DecimalPipe, TbChart, TbSheet, TbMore],
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

  protected readonly periodHours = signal(24);
  protected readonly byBuilding = signal(false);
  protected readonly buildingId = signal<number | null>(null);
  protected readonly loading = signal(false);
  private readonly cache = inject(CurveCache);
  /** Curves hidden from the chart, by element. */
  protected readonly hidden = signal<Set<number>>(new Set());
  protected readonly sortState = signal<{ by: Sort; desc: boolean } | null>(null);

  protected readonly NO_BUILDING = NO_BUILDING;

  protected readonly buildings = computed(() => [...this.store.buildings()].sort(byName((b) => b.name)));

  /** The rooms (or buildings) chosen, from the tree: their figures of now need no curve. */
  private readonly elements = computed(() => {
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
    return elements.sort((a, b) => normalize(a.path).localeCompare(normalize(b.path), 'fr') || normalize(a.n.name).localeCompare(normalize(b.n.name), 'fr'));
  });

  /** Key of the choices: the curves read belong to it. */
  private readonly choice = computed(() => `measurements|${this.byBuilding()}|${this.buildingId()}|${this.periodHours()}`);
  /** Curves read for the current choice (the period is the same for all of them). */
  private readonly curves = signal<Curves>(emptyCurves(''));

  protected readonly rows = computed<Row[]>(() => {
    const read = this.curves();
    const curves = read.key === this.choice() ? read.byId : new Map<number, Curve>();
    return this.elements().map(({ n, path }, i): Row => {
      const c = curves.get(n.id) ?? null;
      const setpoint = n.setpoint?.value ?? null;
      return {
        element: n,
        path,
        color: (i % 8) + 1,
        current: n.temperature,
        min: c?.min ?? null,
        max: c?.max ?? null,
        average: c?.average ?? null,
        setpoint,
        delta: n.temperature != null && setpoint != null ? n.temperature - setpoint : null,
        inTarget: c ? inTarget(c, setpoint) : null,
        state: stateOf(n.temperature, setpoint),
        curve: c,
      };
    });
  });

  protected readonly hasData = computed(() => this.rows().filter((l) => l.current != null));
  protected readonly hottest = computed(() => this.hasData().reduce<Row | null>((m, l) => (!m || l.current! > m.current! ? l : m), null));
  protected readonly coldest = computed(() => this.hasData().reduce<Row | null>((m, l) => (!m || l.current! < m.current! ? l : m), null));
  protected readonly overallAverage = computed(() => {
    const l = this.hasData();
    return l.length ? l.reduce((s, x) => s + x.current!, 0) / l.length : null;
  });
  protected readonly offSetpoint = computed(() => this.rows().filter((l) => offSetpoint(l.state)).length);

  /** The table, sorted as asked (clicking a column title). */
  protected readonly sortedRows = computed(() => {
    const t = this.sortState();
    const l = this.rows();
    if (!t) return l;
    const key = (x: Row): number | string | null =>
      t.by === 'name' ? normalize(x.element.name) : t.by === 'target' ? x.inTarget : x[t.by];
    return [...l].sort((a, b) => {
      const valueA = key(a);
      const valueB = key(b);
      if (valueA == null) return 1;
      if (valueB == null) return -1;
      const c = typeof valueA === 'string' ? valueA.localeCompare(valueB as string, 'fr') : (valueA as number) - (valueB as number);
      return t.desc ? -c : c;
    });
  });

  /**
   * Many rooms: the table and the chart show the first [ROWS] (in the order of the table), more
   * as the end of the table comes near; only their curves are read. Hundreds of curves on one
   * chart read as nothing, and cost as much to download.
   */
  protected readonly shown = new ShownCount(ROWS);
  protected readonly shownRows = computed(() => this.sortedRows().slice(0, this.shown.count()));
  /** Curves of the rows shown not read yet. */
  protected readonly waiting = computed(() => this.shownRows().filter((l) => !l.curve).length);

  /** On the chart: the rows shown whose curve is read. */
  private readonly chartRows = computed(() => this.shownRows().filter((l) => l.curve));
  protected readonly series = computed<ChartSeries[]>(() => {
    const hidden = this.hidden();
    return this.chartRows().map((l) => ({ label: l.element.name ?? '', color: `--tb-series-${l.color}`, values: l.curve!.values, hidden: hidden.has(l.element.id) }));
  });
  protected readonly labels = computed(() => {
    const format = this.periodHours() <= 24 ? clockTime : ddmmHHmm;
    return this.curves().instants.map((t) => format(new Date(t)));
  });

  protected readonly stepText = computed(() => (this.periodHours() <= 24 ? "quart d'heure" : this.periodHours() <= 168 ? 'heure' : 'tranche de 4 h'));

  constructor() {
    // Rows shown without their curve: read (a little later, the table may still grow)
    effect((onCleanup) => {
      const fresh = this.curves().fresh;
      const missing = this.shownRows().filter((l) => !fresh.has(l.element.id)).map((l) => l.element.id);
      if (!missing.length || !this.started()) return;
      const t = setTimeout(() => void untracked(() => this.read(missing)), 120);
      onCleanup(() => clearTimeout(t));
    });
  }

  /** The tree is there: the curves may be read. */
  private readonly started = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load(this.store.tree() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les salles', errorMessage(e));
    }
    this.load();
    this.started.set(true);
  }

  /**
   * Another choice (period, rooms or buildings, building): its curves kept in memory show at
   * once, and are read again (those shown) when no longer recent.
   */
  protected load(force = false): void {
    const key = this.choice();
    const kept = this.cache.read<Curves>(key);
    this.shown.reset();
    if (kept && !force && kept.age < freshness(this.periodHours())) {
      this.curves.set(kept.value);
      return;
    }
    this.curves.set(emptyCurves(key, this.periodHours(), kept?.value));
  }

  /** Reads the curves of [ids] for the current choice, a few hundred points each. */
  private async read(ids: number[]): Promise<void> {
    const c = this.curves();
    if (c.key !== this.choice()) return;
    this.loading.set(true);
    try {
      const p = step(c.start, c.end);
      const averages = await firstValueFrom(this.climate.averages(ids, new Date(c.start), new Date(c.end), true, 2 * c.instants.length));
      // The choices changed meanwhile: these curves are not the ones asked for any more
      if (this.curves().key !== c.key) return;
      const byId = new Map(this.curves().byId);
      const fresh = new Set(this.curves().fresh);
      // A curve kept from before was on its own time axis: all of them on the new one
      if (!fresh.size) byId.clear();
      for (const id of ids) {
        fresh.add(id);
        const points = (averages[String(id)] ?? []).filter((x) => x.value != null).map((x) => ({ t: time(x.date), v: x.value! }));
        byId.set(id, curve(points, c.start, c.end, p));
      }
      const next = { ...this.curves(), byId, fresh, instants: instants(c.start, c.end, p) };
      this.curves.set(next);
      this.cache.write(c.key, next);
    } catch (e) {
      this.toasts.error('Impossible de charger les courbes', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    await this.store.load(true).catch(() => undefined);
    this.load(true);
  }

  protected period(h: number): void {
    this.periodHours.set(h);
    this.load();
  }

  protected group(byBuilding: boolean): void {
    this.byBuilding.set(byBuilding);
    this.hidden.set(new Set());
    this.load();
  }

  protected chooseBuilding(v: string): void {
    this.buildingId.set(v === '' ? null : Number(v));
    this.hidden.set(new Set());
    this.load();
  }

  protected sort(by: Sort): void {
    this.sortState.update((t) => (t?.by === by ? (t.desc ? null : { by, desc: true }) : { by, desc: false }));
  }

  protected sortIcon(by: Sort): string {
    const t = this.sortState();
    return t?.by !== by ? 'pi-sort-alt' : t.desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  }

  /** Colour chip of a row: shows or hides its curve. */
  protected toggleCurve(id: number): void {
    this.hidden.update((s) => {
      const r = new Set(s);
      if (r.has(id)) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  /** From the legend of the chart. */
  protected onToggle(e: { index: number; visible: boolean }): void {
    const id = this.chartRows()[e.index]?.element.id;
    if (id == null) return;
    this.hidden.update((s) => {
      const r = new Set(s);
      if (e.visible) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  protected highlight(id: number | null): void {
    this.chart()?.highlight(id == null ? -1 : this.chartRows().findIndex((l) => l.element.id === id));
  }

  private readonly chart = viewChild(TbChart);

  /** Points of the chart: one line per moment, one column per curve (French spreadsheet format). */
  protected async exportCsv(): Promise<void> {
    // Every row, not only those shown: their curves first
    const fresh = this.curves().fresh;
    const missing = this.rows().filter((l) => !fresh.has(l.element.id)).map((l) => l.element.id);
    if (missing.length) await this.read(missing);
    const rowsOut = this.rows().filter((l) => l.curve);
    const symbol = this.unit.symbol();
    const cell = (t: string) => `"${t.replace(/"/g, '""')}"`;
    const rows = [['Moment', ...rowsOut.map((l) => `${l.element.name} (${symbol})`)].map(cell).join(';')];
    this.curves().instants.forEach((t, k) => {
      rows.push(
        [
          cell(full(new Date(t))),
          ...rowsOut.map((l) => {
            const v = l.curve!.values[k];
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
  /** The lines of the page shown. */
  protected readonly rawPage = signal<TemperatureTyped[]>([]);
  protected readonly rawPageIndex = signal(0);
  /** Pages in all, when the server tells how many lines there are (null: unknown). */
  protected readonly rawPages = signal<number | null>(null);
  protected readonly rawHasNext = signal(false);
  private feed?: RawFeed;

  /** Read only once its section is opened, a page at a time (there can be millions). */
  protected onRaw(e: Event): void {
    const open = (e.target as HTMLDetailsElement).open;
    this.rawOpen.set(open);
    if (open && !this.rawLoaded()) void this.loadRaw();
  }

  protected filter(f: TemperatureType | 'all'): void {
    this.typeFilter.set(f);
    void this.loadRaw();
  }

  /** From the first page again (another type, a line added, changed or deleted). */
  private async loadRaw(): Promise<void> {
    const f = this.typeFilter();
    this.feed = new RawFeed(this.temperatures, f === 'all' ? ['measurement', 'setpoint'] : [f]);
    await this.showRawPage(0);
    this.rawLoaded.set(true);
  }

  protected async showRawPage(i: number): Promise<void> {
    const feed = this.feed;
    if (!feed) return;
    try {
      const r = await feed.slice(i * RAW_PAGE, RAW_PAGE);
      if (feed !== this.feed) return;
      this.rawPage.set(r.items);
      this.rawPageIndex.set(i);
      this.rawHasNext.set(r.more);
      const total = feed.total;
      this.rawPages.set(total != null ? Math.max(1, Math.ceil(total / RAW_PAGE)) : null);
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
