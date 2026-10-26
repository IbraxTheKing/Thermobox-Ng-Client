import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { UpdateNoticeService } from '../../core/update-notice';
import { PointT, Sparkline, sparkline } from '../../core/curves';
import { clockTime, time } from '../../core/dates';
import { STATES, RoomState, STATE_ORDER, countLabel, stateOf } from '../../core/state';
import { ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { TransitionsService } from '../../core/transitions';
import { matches, normalize, byName, plural } from '../../core/text';
import { UnitService } from '../../core/unit';
import { Node, Point } from '../../models/models';
import { TreeStore } from '../../services/tree.store';
import { PullToRefresh } from '../../ui/pull-to-refresh';
import { CurveCache } from '../../core/curve-cache';
import { ClimateService } from '../../services/climate.service';
import { FavoriteService } from '../../services/favorite.service';
import { DeltaRange } from './delta-range';
import { TbRoomOverview } from './room-overview';
import { TbRoomCard } from './room-card';
import { RoomSummary } from './summary';

/** The rooms of a building (or those without building when [batiment] is null). */
interface BuildingGroup {
  building: Node | null;
  name: string;
  /** Panel: the rooms of each floor, one row of squares (nom null: directly in the building). */
  floors: { name: string | null; key: string; rooms: RoomSummary[] }[];
  /** Key of the section in the folded sections (see replie). */
  key: string;
  average: number | null;
  rooms: RoomSummary[];
}

const NO_BUILDING = -1;
const SECTIONS_KEY = 'tb-sections';
const TREND_PERIOD = 24 * 3_600_000;
const TREND_VALIDITY = 5 * 60_000;
const TRENDS_KEY = 'overview';
const POLL = 30_000;

/**
 * Aperçu (dashboard.xhtml): every room the user may see, as a card with its temperature, state,
 * setpoint and its curve over 24 h; favourites first, then one section per building. Refreshed
 * every 30 seconds.
 */
@Component({
  selector: 'tb-dashboard',
  imports: [RouterLink, TbRoomCard, TbRoomOverview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  // Computers: the size of the cards (the slider of the header)
  host: { '[style.--z]': 'prefs.cardSize()' },
})
export class DashboardPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(TreeStore);
  protected readonly unit = inject(UnitService);
  protected readonly notice = inject(UpdateNoticeService);
  private readonly climate = inject(ClimateService);
  private readonly favoritesApi = inject(FavoriteService);
  private readonly toasts = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly transitions = inject(TransitionsService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly range = inject(DeltaRange);
  /** Look of the site: the thermal map (Panel) or the tiles of a home (Home). */
  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  /** Cards glide to their new places when a filter or a favourite changes them. */
  private readonly flip = inject(FlipService);

  // Filters
  protected readonly search = signal('');
  protected readonly stateFilter = signal<RoomState | null>(null);

  constructor() {
    // The page takes the colour of the state picked (« Couleurs selon l'état »)
    effect(() => this.transitions.setTone(this.stateFilter()?.tone ?? null));
    inject(DestroyRef).onDestroy(() => this.transitions.setTone(null));
  }
  protected readonly buildingId = signal<number | null>(null);

  /** Curves of the last 24 h by room: undefined while they load, null without enough measures. */
  private readonly cache = inject(CurveCache);
  /** Phones: pull the page down to refresh it (the button is then hidden). */
  protected readonly pull = inject(PullToRefresh).activate(() => this.refresh());
  /** Kept in memory (CurveCache): back on the dashboard, the curves are there at once. */
  private readonly keptTrends = this.cache.read<Map<number, Sparkline | null>>(TRENDS_KEY);
  private readonly trends = signal<Map<number, Sparkline | null> | null>(this.keptTrends?.value ?? null);
  private trendsComputedAt = this.keptTrends ? Date.now() - this.keptTrends.age : 0;
  /** True in the refresh that brings the curves: they draw themselves once. */
  protected readonly newCurves = signal(false);

  protected readonly folded = signal<Set<string>>(readSections());
  private timer?: ReturnType<typeof setInterval>;

  /** Every card, before filtering. */
  protected readonly all = computed<RoomSummary[]>(() => {
    const trends = this.trends();
    return this.store.rooms().map((room) => {
      const setpoint = room.setpoint?.value ?? null;
      return {
        room,
        path: this.store.pathText(room.id),
        building: this.store.buildingOf(room.id),
        state: stateOf(room.temperature, setpoint),
        delta: room.temperature != null && setpoint != null ? room.temperature - setpoint : null,
        trend: trends ? (trends.get(room.id) ?? null) : undefined,
      };
    });
  });

  protected readonly buildings = computed(() => [...this.store.buildings()].sort(byName((b) => b.name)));

  /** One chip per state that at least one room is in. */
  protected readonly counters = computed(() => {
    const byState = new Map<RoomState, number>();
    for (const r of this.all()) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
    return STATE_ORDER.filter((e) => byState.has(e)).map((state) => ({ state, count: byState.get(state)!, text: countLabel(state, byState.get(state)!) }));
  });

  private readonly visible = computed(() => {
    const b = this.buildingId();
    const search = this.search();
    const state = this.stateFilter();
    return this.all()
      .filter((r) => b == null || (b === NO_BUILDING ? r.building == null : r.building?.id === b))
      .filter((r) => !search.trim() || matches(`${r.room.name} ${r.path}`, search))
      .filter((r) => state == null || r.state === state)
      .filter((r) => !this.panel() || this.inRange(r.delta))
      .sort(byName((r) => r.room.name));
  });

  // ---------------------------------------------------------------- Panel: the scale

  /** The scale spans ±2.5 tolerances: beyond, the colour no longer changes. */
  protected readonly extent = computed(() => Math.round(2.5 * this.prefs.tolerance() * 10) / 10);
  protected readonly rangeActive = computed(() => this.range.bottom() != null || this.range.top() != null);
  /** Position of a gap on the bar, 0-100. */
  protected percent(delta: number): number {
    const e = this.extent();
    return ((Math.max(-e, Math.min(e, delta)) + e) / (2 * e)) * 100;
  }
  private inRange(delta: number | null): boolean {
    const bottom = this.range.bottom();
    const top = this.range.top();
    if (bottom == null && top == null) return true;
    if (delta == null) return false;
    return (bottom == null || delta >= bottom - 1e-9) && (top == null || delta <= top + 1e-9);
  }
  /** Each room as a tick on the bar, where its gap puts it. */
  protected readonly marks = computed(() =>
    this.all()
      .filter((r) => r.delta != null)
      .map((r) => ({ id: r.room.id, name: r.room.name ?? '', delta: r.delta!, pct: this.percent(r.delta!), inside: this.inRange(r.delta) })),
  );
  /** A handle moved: at the end of the bar, no bound on that side. */
  protected setBound(side: 'bas' | 'haut', value: number): void {
    const e = this.extent();
    const v = Math.round(value * 10) / 10;
    this.flip.animate(() => {
      if (side === 'bas') this.range.bottom.set(v <= -e ? null : Math.min(v, this.range.top() ?? e));
      else this.range.top.set(v >= e ? null : Math.max(v, this.range.bottom() ?? -e));
    });
  }
  protected showAll(): void {
    this.flip.animate(() => {
      this.range.bottom.set(null);
      this.range.top.set(null);
    });
  }
  protected setTolerance(t: number): void {
    this.prefs.tolerance.set(t);
    // The bounds stay inside the new scale
    const e = this.extent();
    if (this.range.bottom() != null && this.range.bottom()! <= -e) this.range.bottom.set(null);
    if (this.range.top() != null && this.range.top()! >= e) this.range.top.set(null);
  }
  /** « De −1,0 °C à +2,0 °C », « +1,0 °C et plus »… */
  protected readonly rangeText = computed(() => {
    const b = this.range.bottom();
    const h = this.range.top();
    if (b == null && h == null) return '';
    if (b == null) return `${this.unit.delta(h)} et moins`;
    if (h == null) return `${this.unit.delta(b)} et plus`;
    return `De ${this.unit.delta(b)} à ${this.unit.delta(h)}`;
  });
  protected readonly visibleCount = computed(() => this.visible().length);

  protected readonly favorites = computed(() => this.visible().filter((r) => r.room.favorite));

  /** Average of each building shown in its section title. */
  private readonly buildingAverages = computed(() => {
    const m = new Map<number | null, number | null>();
    if (this.store.all()) {
      // Average of every box of the building, not of the room averages (rooms differ in size)
      for (const b of this.store.buildings()) m.set(b.id, b.temperature);
    } else {
      // Limited user: over the rooms they may see only, weighted by their number of boxes
      const byBuilding = new Map<number | null, { sum: number; n: number }>();
      for (const r of this.all()) {
        if (r.room.temperature == null || r.room.devices <= 0) continue;
        const k = r.building?.id ?? null;
        const acc = byBuilding.get(k) ?? { sum: 0, n: 0 };
        acc.sum += r.room.temperature * r.room.devices;
        acc.n += r.room.devices;
        byBuilding.set(k, acc);
      }
      for (const [k, v] of byBuilding) m.set(k, v.sum / v.n);
    }
    return m;
  });

  /** A favourite is shown once, in its own section. */
  protected readonly groups = computed<BuildingGroup[]>(() => {
    const byBuilding = new Map<number | null, RoomSummary[]>();
    for (const r of this.visible().filter((x) => !x.room.favorite)) {
      const k = r.building?.id ?? null;
      byBuilding.set(k, [...(byBuilding.get(k) ?? []), r]);
    }
    const averages = this.buildingAverages();
    return [...byBuilding.entries()]
      .map(([id, rooms]) => {
        const building = rooms[0].building;
        return { building, name: building?.name ?? 'Sans bâtiment', key: id != null ? `b${id}` : 'none', average: averages.get(id) ?? null, rooms, floors: this.byFloor(rooms) };
      })
      .sort((a, b) => {
        // The order arranged by hand first (the handles of the titles), then by name
        const order = this.prefs.buildingOrder();
        const ia = order.indexOf(a.key);
        const ib = order.indexOf(b.key);
        if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
        return Number(a.building == null) - Number(b.building == null) || normalize(a.name).localeCompare(normalize(b.name), 'fr');
      });
  });

  // ---------------------------------------------------------------- arranging the buildings

  private readonly host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly injector = inject(Injector);
  /** The section being dragged by its handle. */
  protected readonly dragged = signal<string | null>(null);
  /** Handles only where there is something to arrange (and a title to hold). */
  protected readonly arrangeable = computed(() => this.groups().length > 1);

  /**
   * The handle of a title held and dragged (mouse, finger, pen): every section folds to its title
   * (the cards fold away as when a section is closed), the one held follows the pointer, the
   * others slide to make room; let go, it glides into its place and the sections open again, the
   * one moved staying where it was let go.
   */
  protected enterSection(key: string, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    let pointerY = e.clientY;
    let image = 0;
    const offsets = new Map<HTMLElement, number>();
    let d: { sections: HTMLElement[]; el: HTMLElement; i: number; target: number; grip: number } | null = null;

    /** Top of a section in the page, without the shift it was given. */
    const natural = (s: HTMLElement) => s.getBoundingClientRect().top + scrollY - (offsets.get(s) ?? 0);
    const shift = (s: HTMLElement, y: number) => {
      offsets.set(s, y);
      s.style.transform = y ? `translateY(${y}px)` : '';
    };

    // Every frame while held: the sections fold under the pointer, the page may scroll
    const follow = () => {
      image = requestAnimationFrame(follow);
      if (!d) return;
      // Near the top or the bottom of the screen: the page scrolls by itself
      if (pointerY < 70) scrollBy(0, -10);
      else if (pointerY > innerHeight - 70) scrollBy(0, 10);
      const tops = d.sections.map(natural);
      const heights = d.sections.map((s) => s.offsetHeight);
      const wanted = pointerY + scrollY - d.grip;
      shift(d.el, wanted - tops[d.i]);
      const center = wanted + heights[d.i] / 2;
      const target = tops.filter((t, k) => k !== d!.i && t + heights[k] / 2 < center).length;
      if (target !== d.target) this.platform.vibrate();
      d.target = target;
      const delta = tops.length > 1 ? Math.max(0, tops[1] - tops[0] - heights[0]) : 0;
      const step = heights[d.i] + delta;
      d.sections.forEach((s, k) => {
        if (k === d!.i) return;
        shift(s, k > d!.i && k <= target ? -step : k < d!.i && k >= target ? step : 0);
      });
    };

    const start = () => {
      const sections = [...this.host.querySelectorAll<HTMLElement>('.tb-section[data-group]')];
      const el = sections.find((s) => s.dataset['group'] === key);
      if (!el) return;
      d = { sections, el, i: sections.indexOf(el), target: sections.indexOf(el), grip: y0 + scrollY - natural(el) };
      this.dragged.set(key);
      this.host.classList.add('tb-reorg');
      this.platform.vibrate();
      image = requestAnimationFrame(follow);
    };
    const move = (ev: PointerEvent) => {
      pointerY = ev.clientY;
      if (!d && Math.abs(ev.clientY - y0) >= 4) start();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      cancelAnimationFrame(image);
      if (!d) return;
      const g = d as { sections: HTMLElement[]; el: HTMLElement; i: number; target: number };
      const before = g.el.getBoundingClientRect().top;
      // The others are already where they go: no jump when the order changes under them
      for (const s of g.sections) {
        s.style.transition = 'none';
        s.style.transform = '';
      }
      const keys = g.sections.map((s) => s.dataset['group']!);
      const [x] = keys.splice(g.i, 1);
      keys.splice(g.target, 0, x);
      this.arrange(keys);
      afterNextRender(
        () => {
          // The one held glides from where it was let go into its place…
          const after = g.el.getBoundingClientRect().top;
          g.el.style.transform = `translateY(${before - after}px)`;
          void g.el.offsetWidth;
          g.el.style.transition = 'transform .28s cubic-bezier(.2, .8, .2, 1), box-shadow .28s';
          g.el.style.transform = '';
          setTimeout(() => {
            for (const s of g.sections) s.style.transition = '';
            // …then the sections open again, the page following it so that it stays in view
            const marker = g.el.getBoundingClientRect().top;
            this.host.classList.remove('tb-reorg');
            this.dragged.set(null);
            const openingEnd = performance.now() + 650;
            const keep = () => {
              scrollBy(0, g.el.getBoundingClientRect().top - marker);
              if (performance.now() < openingEnd) requestAnimationFrame(keep);
            };
            requestAnimationFrame(keep);
          }, 280);
        },
        { injector: this.injector },
      );
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Keyboard: the arrows move the section held by its handle one place up or down. */
  protected moveSection(key: string, direction: -1 | 1, e: Event): void {
    e.preventDefault();
    const keys = this.groups().map((g) => g.key);
    const i = keys.indexOf(key);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    this.flip.animate(() => this.arrange(keys));
    // The focus stays on the handle that moved
    const handle = e.currentTarget as HTMLElement;
    afterNextRender(() => handle.focus(), { injector: this.injector });
  }

  /** The new order, keeping the place of the buildings filtered out for now. */
  private arrange(keys: string[]): void {
    const before = this.prefs.buildingOrder().filter((c) => !keys.includes(c));
    this.prefs.buildingOrder.set([...keys, ...before]);
  }

  // ---------------------------------------------------------------- overview of a card (long press)

  protected readonly overviewId = signal<number | null>(null);
  /** Follows the room while it is open (a favourite toggled, a refresh). */
  protected readonly overview = computed(() => this.all().find((x) => x.room.id === this.overviewId()) ?? null);
  protected openOverview(id: number): void {
    this.overviewId.set(id);
  }

  /** Panel: one row per floor, in the order of their names; the rooms without floor first. */
  private byFloor(rooms: RoomSummary[]): BuildingGroup['floors'] {
    const m = new Map<number | null, { name: string | null; key: string; rooms: RoomSummary[] }>();
    for (const r of rooms) {
      const floor = this.store.path(r.room.id).find((n) => n.kind === 'FLOOR') ?? null;
      const k = floor?.id ?? null;
      const g = m.get(k) ?? { name: floor?.name ?? null, key: k == null ? 'none' : `e${k}`, rooms: [] };
      g.rooms.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => Number(a.name != null) - Number(b.name != null) || normalize(a.name ?? '').localeCompare(normalize(b.name ?? ''), 'fr', { numeric: true }));
  }

  /** Panel: the state counters at the top, every state even at zero (a desk shows its lamps). */
  protected readonly lights = computed(() => {
    const byState = new Map<RoomState, number>();
    for (const r of this.all()) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
    const l: { state: RoomState; count: number }[] = [STATES.TOO_HOT, STATES.HEATING, STATES.STABLE].map((state) => ({ state, count: byState.get(state) ?? 0 }));
    if (byState.get(STATES.UNKNOWN)) l.push({ state: STATES.UNKNOWN, count: byState.get(STATES.UNKNOWN)! });
    return l;
  });
  protected readonly lightNames: Record<string, string> = { hot: 'Trop chaudes', heating: 'En chauffe', stable: 'Stables', unknown: 'Sans mesure' };

  /** Panel: time of the last measure received, any room. */
  protected readonly lastReading = computed(() => {
    const t = Math.max(0, ...this.all().map((r) => (r.room.lastMeasurement ? time(r.room.lastMeasurement) : 0)).filter((x) => !isNaN(x)));
    return t > 0 ? clockTime(new Date(t)) : null;
  });

  /**
   * Home: the house in one sentence, what a person wants to know first. « Il fait bon partout. »,
   * or what is not comfortable, by name. Parts in bold: the names.
   */
  protected readonly sentence = computed<{ text: string; name?: boolean }[]>(() => {
    const all = this.all();
    if (!all.length) return [];
    const by = (tone: string) => all.filter((r) => r.state.tone === tone).map((r) => r.room.name ?? '');
    const hot = by('hot');
    const heating = by('heating');
    const unknown = by('unknown');
    if (!hot.length && !heating.length && !unknown.length) return [{ text: all.length > 1 ? 'Il fait bon partout.' : 'Il fait bon.' }];
    const pieces: { text: string; name?: boolean }[] = [];
    const stable = all.length - hot.length - heating.length - unknown.length;
    if (stable >= all.length / 2) pieces.push({ text: 'Il fait bon presque partout. ' });
    const names = (l: string[]) => {
      // More than three: a count rather than a list
      if (l.length > 3) return [{ text: `${l.length} pièces` }];
      return l.flatMap((n, i) => [...(i ? [{ text: i === l.length - 1 ? ' et ' : ', ' }] : []), { text: n, name: true }]);
    };
    const sentences: { text: string; name?: boolean }[][] = [];
    if (heating.length) sentences.push([...names(heating), { text: heating.length > 1 ? ' chauffent' : ' chauffe' }]);
    if (hot.length) sentences.push([{ text: 'il fait un peu chaud dans ' }, ...names(hot)]);
    if (unknown.length) sentences.push([{ text: 'pas de mesure pour ' }, ...names(unknown)]);
    sentences.forEach((p, i) => {
      if (i) pieces.push({ text: i === sentences.length - 1 ? ' et ' : ', ' });
      pieces.push(...p);
    });
    pieces.push({ text: '.' });
    // A capital letter at the start of each sentence
    const first = pieces.findIndex((m, i) => i === 0 || pieces[i - 1].text.endsWith('. '));
    if (first >= 0 && !pieces[first].name) pieces[first] = { ...pieces[first], text: pieces[first].text.charAt(0).toUpperCase() + pieces[first].text.slice(1) };
    const after = pieces.findIndex((m, i) => i > 0 && pieces[i - 1].text.endsWith('. '));
    if (after > 0 && !pieces[after].name) pieces[after] = { ...pieces[after], text: pieces[after].text.charAt(0).toUpperCase() + pieces[after].text.slice(1) };
    return pieces;
  });

  /** Home: few rooms, no search nor filters; one building, no section titles. */
  protected readonly hasFilters = computed(() => this.panel() || this.all().length > 12);
  protected readonly severalBuildings = computed(() => this.store.buildings().length > 1);

  protected readonly empty = computed(() => this.store.tree() != null && this.all().length === 0);
  protected readonly noResult = computed(() => this.all().length > 0 && this.favorites().length === 0 && this.groups().length === 0);
  protected readonly pending = computed(() => this.store.tree() == null);

  protected readonly NO_BUILDING = NO_BUILDING;
  protected readonly plural = plural;

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load(this.store.tree() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les salles', errorMessage(e));
    }
    // The curves come in a second request, so the page shows without waiting for them; kept
    // ones are already there (and don't draw themselves again)
    const kept = this.trends();
    void this.loadTrends(false).then(() => this.newCurves.set(this.trends() !== kept));
    this.timer = setInterval(() => void this.reload(true), POLL);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  /** "Actualiser": unlike the poll, also redraws the curves. */
  protected async refresh(): Promise<void> {
    this.trendsComputedAt = 0;
    await this.reload(false);
  }

  private async reload(quiet: boolean): Promise<void> {
    try {
      await this.store.load(quiet);
      this.newCurves.set(false);
      await this.loadTrends(quiet);
    } catch (e) {
      if (!quiet) this.toasts.error('Actualisation impossible', errorMessage(e));
    }
  }

  /** Average curve of each room over the last 24 h: read again every few minutes, not on every poll. */
  private async loadTrends(quiet: boolean): Promise<void> {
    const rooms = this.store.rooms();
    const known = this.trends();
    const allKnown = !!known && rooms.every((s) => known.has(s.id));
    if (allKnown && Date.now() - this.trendsComputedAt < TREND_VALIDITY) {
      return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - TREND_PERIOD);
    const m = new Map<number, Sparkline | null>();
    try {
      // At most 200 elements per request (server limit)
      for (let i = 0; i < rooms.length; i += 200) {
        const batch = rooms.slice(i, i + 200);
        const r = await firstValueFrom(this.climate.averages(batch.map((s) => s.id), start, end, quiet));
        for (const s of batch) m.set(s.id, sparkline(points(r[String(s.id)] ?? []), start.getTime(), end.getTime(), s.setpoint?.value ?? null));
      }
      this.trends.set(m);
      this.trendsComputedAt = Date.now();
      this.cache.write(TRENDS_KEY, m);
    } catch {
      if (!this.trends()) this.trends.set(new Map(rooms.map((s) => [s.id, null])));
    }
  }

  protected async toggleFavorite(id: number): Promise<void> {
    const n = this.store.byId().get(id);
    if (!n) return;
    const favorite = !n.favorite;
    // The card flies to the favourites (or back to its building), its star spins
    this.flip.animate(() => this.store.replace({ ...n, favorite }));
    this.platform.vibrate();
    try {
      await firstValueFrom(favorite ? this.favoritesApi.add(id) : this.favoritesApi.remove(id));
    } catch (e) {
      this.flip.animate(() => this.store.replace({ ...n, favorite: !favorite }));
      this.toasts.error('Impossible de modifier les favoris', errorMessage(e));
    }
  }

  /** Summary chip: shows only the rooms in [etat]; a second click shows them all again. */
  protected toggleState(state: RoomState): void {
    this.flip.animate(() => this.stateFilter.update((e) => (e === state ? null : state)));
  }

  protected chooseBuilding(v: string): void {
    this.flip.animate(() => this.buildingId.set(v === '' ? null : Number(v)));
  }

  protected onSearch(v: string): void {
    this.flip.animate(() => this.search.set(v));
  }

  protected clearFilters(): void {
    this.flip.animate(() => {
      this.search.set('');
      this.buildingId.set(null);
      this.stateFilter.set(null);
      this.range.bottom.set(null);
      this.range.top.set(null);
    });
  }

  protected isFolded(key: string): boolean {
    return this.folded().has(key);
  }

  /** Each section folds and unfolds from its title; kept on this device. */
  protected toggleSection(key: string): void {
    this.folded.update((s) => {
      const r = new Set(s);
      if (r.has(key)) r.delete(key);
      else r.add(key);
      writeSections(r);
      return r;
    });
  }

  protected readonly STATES = STATES;
}

function points(l: Point[]): PointT[] {
  return l.filter((p) => p.value != null).map((p) => ({ t: time(p.date), v: p.value! })).filter((p) => !isNaN(p.t));
}

function readSections(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSections(s: Set<string>): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify([...s]));
  } catch {
    /* private browsing */
  }
}
