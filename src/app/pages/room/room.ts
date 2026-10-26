import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { PointT, forChart } from '../../core/curves';
import { full, ddmmAtHHmm, ddmmHHmm, time, toField } from '../../core/dates';
import { stateOf } from '../../core/state';
import { ConfirmService, ToastService } from '../../core/messages';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { homeDeltaColor, roomColor, temperatureColor, tintSoft, tintStrong } from '../../core/colors';
import { BackgroundService } from '../../core/background';
import { TitleService } from '../../core/title';
import { TransitionsService } from '../../core/transitions';
import { FlipService } from '../../core/flip';
import { BackGestureService } from '../../core/back-gesture';
import { UnitService } from '../../core/unit';
import { DetailElement, History, Node, Point } from '../../models/models';
import { TreeStore, LABELS } from '../../services/tree.store';
import { CurveCache, freshness } from '../../core/curve-cache';
import { ClimateService } from '../../services/climate.service';
import { FavoriteService } from '../../services/favorite.service';
import { HierarchyService } from '../../services/hierarchy.service';
import { ImagesService } from '../../services/images.service';
import { RoomService } from '../../services/room.service';
import { TbStepper, TbSwitch, TbWatch } from '../../ui/controls';
import { ChartSeries, TbChart } from '../../ui/chart';
import { TbPhotoImg } from '../../ui/photo';
import { ShownCount, TbMore } from '../../ui/more';
import { TbDial } from '../../ui/dial';

/** One colour per box or room, defined by the theme (light and dark differ). */
const PALETTE = Array.from({ length: 8 }, (_, i) => `--tb-series-${i + 1}`);
const DEFAULT_SETPOINT = 20;
/** A floor or a building with more rooms: its average curve only. */
const MAX_ROOM_CURVES = 12;
/** Room tiles of a floor or a building drawn at a time. */
const ROOM_TILES = 48;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

/**
 * Page of an element (room.xhtml): average of its boxes, setpoint, photo, history. A room shows
 * its boxes; an floor or a building shows its rooms (tiles and curves). Refreshed every 30 s.
 */
@Component({
  selector: 'tb-room-page',
  imports: [RouterLink, NgTemplateOutlet, TbStepper, TbSwitch, TbWatch, TbChart, TbPhotoImg, TbDial, TbMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './room.html',
})
export class RoomPage implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly unit = inject(UnitService);
  private readonly climate = inject(ClimateService);
  private readonly cache = inject(CurveCache);
  private readonly rooms = inject(RoomService);
  private readonly hierarchy = inject(HierarchyService);
  private readonly favorites = inject(FavoriteService);
  private readonly images = inject(ImagesService);
  private readonly store = inject(TreeStore);
  private readonly transitions = inject(TransitionsService);
  private readonly flip = inject(FlipService);
  protected readonly phone = inject(PlatformService).phone;
  /** Phones: the « Du / Au » fields are shown. */
  protected readonly customRange = signal(false);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly title = inject(TitleService);
  private readonly platform = inject(PlatformService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Route parameter :id */
  readonly id = input.required<string>();

  protected readonly detail = signal<DetailElement | null>(null);
  /** Many rooms in a floor or a building: their tiles a part at a time. */
  protected readonly shownRooms = new ShownCount(ROOM_TILES);
  protected readonly missing = signal(false);
  protected readonly labels = LABELS;

  // Consigne
  protected readonly newSetpoint = signal<number | null>(null);
  protected readonly force = signal(false);
  protected readonly sending = signal(false);

  // History
  /** Shortcut in use (24, 168 or 720 h), null once dates were picked by hand. */
  protected readonly periodHours = signal<number | null>(24);
  protected readonly start = signal(toField(new Date(Date.now() - 24 * 3_600_000)));
  protected readonly end = signal(toField(new Date()));
  protected readonly history = signal<History | null>(null);
  protected readonly setpointsPage = signal(0);

  protected readonly photoUploading = signal(false);

  private timer?: ReturnType<typeof setInterval>;

  protected readonly element = computed(() => this.detail()?.element ?? null);
  protected readonly kind = computed(() => this.element()?.kind);
  protected readonly device = computed(() => this.kind() === 'DEVICE');
  protected readonly container = computed(() => this.kind() === 'FLOOR' || this.kind() === 'BUILDING');
  /** Only rooms go on the dashboard, so only they can be favourites. */
  protected readonly isRoom = computed(() => this.kind() === 'ROOM');
  protected readonly state = computed(() => stateOf(this.element()?.temperature, this.element()?.setpoint?.value));
  protected readonly lastMeasurement = computed(() => this.element()?.lastMeasurement ?? null);

  // Look of the site (tokens.css)
  private readonly prefs = inject(PreferencesService);
  private readonly background = inject(BackgroundService);
  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  private readonly dark = computed(() => this.prefs.theme() === 'dark');
  /** Home: the colour of the temperature itself (the dial, the page behind it). */
  protected readonly homeColor = computed(() => tintStrong(this.baseColor(), this.dark()));
  /**
   * Home: the colour of the room (its gap to the setpoint, or its temperature: Preferences).
   * While the dial is being turned, the page previews the setpoint asked for: by gap, the room
   * against that setpoint; by temperature, the temperature asked for.
   */
  private readonly baseColor = computed(() => {
    const e = this.element();
    const mode = this.prefs.homeColors();
    const tolerance = this.prefs.tolerance();
    if (this.setpointChanged() && this.auth.canSetSetpoint()) {
      const fresh = this.unit.inputToCelsius(this.newSetpoint()!);
      return mode === 'delta' && e?.temperature != null ? homeDeltaColor(e.temperature - fresh, tolerance) : temperatureColor(fresh);
    }
    return roomColor(e?.temperature, e?.setpoint?.value, mode, tolerance);
  });
  /** Panel: the gap to the setpoint, written beside the state. */
  protected readonly delta = computed(() => {
    const e = this.element();
    return e?.temperature != null && e.setpoint?.value != null ? e.temperature - e.setpoint.value : null;
  });
  /** Home: the dial was turned away from the current setpoint. */
  protected readonly setpointChanged = computed(() => {
    const v = this.newSetpoint();
    const c = this.element()?.setpoint?.value;
    return v != null && (c == null || Math.abs(this.unit.inputToCelsius(v) - c) >= 0.05);
  });
  /** Home: what the room is doing, in a sentence. */
  protected readonly homeSentence = computed(() => {
    const e = this.element();
    if (!e || this.device()) return '';
    const c = e.setpoint?.value;
    switch (this.state().tone) {
      case 'stable': return 'Il fait bon.';
      case 'heating': return `Chauffe pour atteindre ${this.unit.t(c)} ${this.unit.symbol()}.`;
      case 'hot': return `Un peu chaud : ${this.unit.delta(this.delta()).replace('+', '')} au-dessus de l'objectif.`;
      default: return e.temperature == null ? 'Pas encore de mesure.' : "Pas d'objectif réglé.";
    }
  });

  /** « Étage 1 (19,0 °C), Everest (22,5 °C) » */
  protected readonly ownSetpointsLabel = computed(() =>
    (this.detail()?.ownSetpoints ?? []).map((c) => `${c.sourceName} (${this.unit.t(c.value)} ${this.unit.symbol()})`).join(', '),
  );

  protected readonly chart = computed(() => {
    const h = this.history();
    const e = this.element();
    if (!h || !e) return null;
    const series: { label: string; color: string; role?: 'setpoint' | 'average'; points: PointT[]; steps?: boolean }[] = [];
    if (this.container()) {
      // One curve per room (average of its boxes) rather than one per box
      h.rooms.forEach((s, i) => series.push({ label: s.name ?? '', color: PALETTE[i % PALETTE.length], points: pts(s.points) }));
      if (h.rooms.length > 1) {
        series.push({ label: e.kind === 'FLOOR' ? "Moyenne de l'étage" : 'Moyenne du bâtiment', color: '--tb-series-average', role: 'average', points: pts(h.average) });
      }
    } else if (!h.devices.length) {
      // VIEWER: the room's temperature only, not one curve per box
      if (h.average.length) series.push({ label: 'Température', color: '--tb-series-average', role: 'average', points: pts(h.average) });
    } else {
      h.devices.forEach((b, i) => series.push({ label: b.name ?? '', color: PALETTE[i % PALETTE.length], points: pts(b.points) }));
      // A single box is its own average: no need for a duplicate curve
      if (h.devices.length > 1) series.push({ label: 'Moyenne de la salle', color: '--tb-series-average', role: 'average', points: pts(h.average) });
    }
    series.push({ label: 'Consigne', color: '--tb-series-setpoint', role: 'setpoint', points: pts(h.setpoints), steps: true });
    const hasPoints = series.filter((s) => s.points.length);
    const { time: t, values } = forChart(hasPoints);
    return {
      labels: t.map((x) => ddmmHHmm(new Date(x))),
      series: hasPoints.map((s, i): ChartSeries => ({ label: s.label, color: s.color, role: s.role, values: values[i] })),
    };
  });

  /** Setpoints of the period, newest first, ten per page. */
  protected readonly periodSetpoints = computed(() =>
    [...(this.history()?.setpoints ?? [])].sort((a, b) => time(b.date) - time(a.date)),
  );
  protected readonly setpointPages = computed(() => Math.max(1, Math.ceil(this.periodSetpoints().length / 10)));

  constructor() {
    // The page takes the colour of the state of the room, at once from what the dashboard
    // already knows (it then comes with the card that morphs into this page)
    const startId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
    const known = this.store.byId().get(startId);
    if (known) this.transitions.setTone(stateOf(known.temperature, known.setpoint?.value).tone);
    // Before the first render: the card of the dashboard morphs into this page, its picture is
    // taken right after that render (an effect could come one render too late)
    this.prime(startId);
    // Phones: swipe the page to the right to go back (TbRetourGeste)
    inject(BackGestureService).activate(() => this.back());
    effect(() => {
      const e = this.element();
      if (e) this.transitions.setTone(this.state().tone);
    });
    inject(DestroyRef).onDestroy(() => this.transitions.setTone(null));
    // Home: the page takes the soft colour of the temperature
    effect(() => {
      const e = this.element();
      this.background.tint(e && !this.panel() ? tintSoft(this.baseColor(), this.dark()) : null);
    });
    inject(DestroyRef).onDestroy(() => this.background.tint(null));
    effect(() => {
      const id = Number(this.id());
      untracked(() => void this.open(id));
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async open(id: number): Promise<void> {
    clearInterval(this.timer);
    // Already shown from the dashboard's data (constructor): kept until the server answers
    if (this.detail()?.element.id !== id) this.prime(id);
    this.missing.set(false);
    // The last 24 h of this room, if already read: there at once
    this.history.set(isNaN(id) ? null : (this.cache.read<History>(`room|${id}|24`)?.value ?? null));
    this.newSetpoint.set(null);
    this.force.set(false);
    this.period(24, false);
    if (isNaN(id)) {
      this.missing.set(true);
      return;
    }
    await this.refresh(id, false);
    if (!this.detail()) return;
    void this.loadHistory();
    // Not while the page is hidden (another tab, the app in the background)
    this.timer = setInterval(() => !document.hidden && void this.refresh(id, true), 30_000);
  }

  /**
   * What the dashboard already knows (name, temperature, setpoint, place): the page is there at
   * once, so the card has a page to morph into; the rest comes with the server's answer.
   */
  private prime(id: number): void {
    const known = isNaN(id) ? undefined : this.store.byId().get(id);
    if (!known) {
      this.detail.set(null);
      return;
    }
    this.detail.set({
      element: known,
      ancestors: this.store.path(id).map((a) => ({ id: a.id, name: a.name, kind: a.kind, accessible: a.accessible })),
      children: [],
      measurements: [],
      ownSetpoints: [],
      rooms: [],
    });
    this.title.set(known.name ?? 'Salle');
  }

  private async refresh(id: number, quiet: boolean): Promise<void> {
    try {
      const d = await firstValueFrom(this.rooms$(id, quiet));
      this.detail.set(d);
      this.title.set(d.element.name ?? 'Salle');
      // The stepper starts from the current setpoint, in the unit of the Preferences page
      if (this.newSetpoint() == null) this.newSetpoint.set(this.unit.forInput(d.element.setpoint?.value ?? DEFAULT_SETPOINT));
    } catch (e) {
      if (quiet && this.detail()) {
        // Accesses withdrawn while the page was open: nothing more is shown
        if ((e as { status?: number }).status === 404) {
          this.detail.set(null);
          this.missing.set(true);
          this.toasts.warn("Vous n'avez plus accès à cet élément");
        }
        return;
      }
      this.detail.set(null);
      this.missing.set(true);
      this.title.set('Élément introuvable');
    }
  }

  private rooms$(id: number, quiet: boolean) {
    return this.hierarchy.detail(id, quiet);
  }

  /** Back to where we came from (the dashboard card returns to its place), else to the dashboard. */
  protected back(e?: Event): void {
    e?.preventDefault();
    const state = this.location.getState() as { navigationId?: number } | null;
    if (state?.navigationId && state.navigationId > 1) this.location.back();
    else void this.router.navigateByUrl('/app/overview');
  }

  // ---------------------------------------------------------------- favourite

  protected async toggleFavorite(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const favorite = !d.element.favorite;
    // Its star spins (FlipService)
    this.flip.animate(() => this.updateElement({ ...d.element, favorite }));
    this.platform.vibrate();
    try {
      await firstValueFrom(favorite ? this.favorites.add(d.element.id) : this.favorites.remove(d.element.id));
      const n = this.store.byId().get(d.element.id);
      if (n) this.store.replace({ ...n, favorite });
    } catch (err) {
      this.updateElement({ ...d.element, favorite: !favorite });
      this.toasts.error('Impossible de modifier les favoris', errorMessage(err));
    }
  }

  private updateElement(n: Node): void {
    const d = this.detail();
    if (d) this.detail.set({ ...d, element: n });
  }

  // ---------------------------------------------------------------- consigne

  /**
   * Saves the setpoint on the element; what it contains follows it, except the floors / rooms
   * that have their own setpoint, unless « Forcer » is on.
   */
  protected async sendSetpoint(): Promise<void> {
    const e = this.element();
    const input = this.newSetpoint();
    if (!e) return;
    if (input == null) {
      this.toasts.warn('Indique une température');
      return;
    }
    const celsius = this.unit.inputToCelsius(input);
    this.sending.set(true);
    try {
      const r = await firstValueFrom(this.climate.sendSetpoint(e.id, celsius, this.force()));
      const title = `Consigne de ${this.unit.t(celsius)} ${this.unit.symbol()} enregistrée`;
      const details = [
        r.devices.length ? `envoyée à ${r.devices.length} boîtier(s)` : 'aucun boîtier à prévenir',
        r.replaced.length ? `remplace celle de ${r.replaced.map((x) => x.name).join(', ')}` : null,
        r.kept.length ? `${r.kept.map((x) => x.sourceName).join(', ')} garde(nt) sa consigne` : null,
      ]
        .filter(Boolean)
        .join(' ; ');
      const text = details.charAt(0).toUpperCase() + details.slice(1);
      if (r.failures.length) this.toasts.warn(title, `${text}. Non transmise à : ${r.failures.map((x) => x.name).join(', ')}`);
      else this.toasts.info(title, text);
      // The colours follow at once, here and on the dashboard: the element takes its new setpoint
      // before the server's answer, the tree (and what inherits from it) is read again
      const setpoint = { value: celsius, date: new Date().toISOString(), inherited: false, sourceId: e.id, sourceName: e.name };
      const d = this.detail();
      if (d) this.detail.set({ ...d, element: { ...d.element, setpoint } });
      this.store.replace({ ...e, setpoint });
      void this.store.load(true).catch(() => undefined);
      this.newSetpoint.set(null);
      this.force.set(false);
      await this.refresh(e.id, true);
      // The new setpoint is in the history: read again, for every period
      this.cache.forget(`room|${e.id}|`);
      void this.loadHistory();
    } catch (err) {
      this.toasts.error('Consigne refusée', errorMessage(err));
    } finally {
      this.sending.set(false);
    }
  }

  // ---------------------------------------------------------------- history

  /** Shortcuts 24 h / 7 j / 30 j */
  protected period(hours: number, load = true): void {
    this.periodHours.set(hours);
    this.customRange.set(false);
    const end = new Date();
    end.setSeconds(0, 0);
    this.end.set(toField(end));
    this.start.set(toField(new Date(end.getTime() - hours * 3_600_000)));
    if (load) void this.loadHistory();
  }

  /** "Afficher", with the dates picked by hand. */
  protected show(): void {
    this.periodHours.set(null);
    void this.loadHistory();
  }

  /**
   * The curves of the period. A floor or a building with many rooms: its average only (a chart
   * of dozens of curves reads as nothing, and costs as much to download), the setpoints from a
   * history reduced to almost nothing.
   */
  private async readHistory(id: number, start: Date, end: Date): Promise<History> {
    if (!this.container() || (this.detail()?.rooms.length ?? 0) <= MAX_ROOM_CURVES) return firstValueFrom(this.climate.history(id, start, end));
    const [h, a] = await Promise.all([firstValueFrom(this.climate.history(id, start, end, 3)), firstValueFrom(this.climate.averages([id], start, end))]);
    return { devices: [], rooms: [], average: a[String(id)] ?? [], setpoints: h.setpoints };
  }

  private async loadHistory(): Promise<void> {
    const e = this.element();
    if (!e) return;
    const start = new Date(this.start());
    const end = new Date(this.end());
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      this.toasts.error('La date de début doit précéder la date de fin');
      return;
    }
    // A period of the shortcuts (24 h, 7 j, 30 j): kept in memory, shown at once when coming back;
    // read again only when it is no longer recent
    const hours = this.periodHours();
    const key = hours != null ? `room|${e.id}|${hours}` : null;
    const kept = key ? this.cache.read<History>(key) : null;
    if (kept) {
      if (this.history() !== kept.value) this.setpointsPage.set(0);
      this.history.set(kept.value);
      if (kept.age < freshness(hours!)) return;
    }
    try {
      const h = await this.readHistory(e.id, start, end);
      // Still the page and the period asked for
      if (this.element()?.id !== e.id || this.periodHours() !== hours) return;
      this.history.set(h);
      if (!kept) this.setpointsPage.set(0);
      if (key) this.cache.write(key, h);
    } catch (err) {
      if (!kept) this.toasts.error("Impossible de charger l'historique", errorMessage(err));
    }
  }

  // ---------------------------------------------------------------- photo (ADMIN)

  protected async upload(ev: Event): Promise<void> {
    const field = ev.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    const e = this.element();
    if (!file || !e) return;
    if (!/^image\/(jpe?g|png|gif|bmp)$/i.test(file.type) && !/\.(jpe?g|png|gif|bmp)$/i.test(file.name)) {
      this.toasts.error('Photo refusée', 'Choisis une image JPEG, PNG, GIF ou BMP.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      this.toasts.error('Photo refusée', "L'image ne doit pas dépasser 10 Mo.");
      return;
    }
    this.photoUploading.set(true);
    try {
      const version = await firstValueFrom(this.rooms.putImage(e.id, file));
      this.images.forget(e.id);
      this.updateElement({ ...e, image: version });
      this.toasts.info('Photo enregistrée');
    } catch (err) {
      this.toasts.error("Impossible d'enregistrer la photo", errorMessage(err));
    } finally {
      this.photoUploading.set(false);
    }
  }

  protected async removePhoto(): Promise<void> {
    const e = this.element();
    if (!e) return;
    const ok = await this.confirm.ask('Retirer la photo', `La photo de « ${e.name} » sera supprimée.`, { confirm: 'Retirer' });
    if (!ok) return;
    try {
      await firstValueFrom(this.rooms.deleteImage(e.id));
      this.images.forget(e.id);
      this.updateElement({ ...e, image: null });
      this.toasts.info('Photo retirée');
    } catch (err) {
      this.toasts.error('Impossible de retirer la photo', errorMessage(err));
    }
  }

  // ---------------------------------------------------------------- formats

  protected deviceDelta(v: number | null): string {
    const avg = this.element()?.temperature;
    return v == null || avg == null ? '' : this.unit.delta(v - avg);
  }

  protected ddmmAtHHmm = ddmmAtHHmm;
  protected ddmmHHmm = ddmmHHmm;
  protected full = full;

  protected toneOf(n: Node): string {
    return stateOf(n.temperature, n.setpoint?.value).tone;
  }

  protected stateLabel(n: Node): string {
    return stateOf(n.temperature, n.setpoint?.value).label;
  }
}

function pts(l: Point[]): PointT[] {
  return l
    .filter((p) => p.value != null)
    .map((p) => ({ t: time(p.date), v: p.value! }))
    .filter((p) => !isNaN(p.t));
}
