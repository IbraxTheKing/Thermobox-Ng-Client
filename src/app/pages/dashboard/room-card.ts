import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { deltaColor, roomColor, tintSoft, tintStrong } from '../../core/colors';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { UnitService } from '../../core/unit';
import { TbWatch } from '../../ui/controls';
import { TbPhotoImg } from '../../ui/photo';
import { RoomSummary } from './summary';

/**
 * A room on the dashboard, in the look of the site (tokens.css):
 *
 * - Panel: a square of the thermal map, coloured by its gap to the setpoint;
 * - Home: a soft tile tinted by its gap to the setpoint (or its temperature: Preferences), its
 *   day as a gentle curve.
 *
 * Its photo, when it has one, lies behind it under the colour (part of the card when it morphs
 * into the page of the room: it does not fly on its own above the words).
 *
 * Held down (finger or mouse, half a second): its whole day and its details (TbRoomOverview), and
 * the click that follows does not open the room.
 *
 * The square or tile opens into the page of the room (data-vt: TransitionsService).
 */
@Component({
  selector: 'tb-room-card',
  imports: [RouterLink, TbWatch, TbPhotoImg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let s = r().room;
    @if (panel()) {
      <article
        class="tb-room tb-cell tb-tone-{{ r().state.tone }}" [class.tb-with-photo]="s.image != null"
        [style.--c]="cellColor().background" [style.--t]="cellColor().text" [style.--d]="cellColor().soft"
        [attr.data-flip]="s.id"
        data-vt="room-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
        [class.tb-press]="pressing()"
        (pointerdown)="press($event)" (contextmenu)="menu($event)"
      >
        <a [routerLink]="['/app/room', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        @if (s.image != null) {
          <span class="tb-cell-photo"><tb-photo-img [roomId]="s.id" [version]="s.image" /></span>
        }
        <span class="tb-cell-name" data-vt="room-name" [attr.data-vt-id]="s.id">{{ s.name }}</span>
        @if (r().trend; as t) {
          <svg class="tb-cell-curve" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path [attr.d]="t.row" /></svg>
        }
        <span class="tb-cell-bottom">
          <b class="tb-figures" data-vt="room-temp" [attr.data-vt-id]="s.id" [tbWatch]="s.temperature">{{ unit.t(s.temperature) }}°</b>
          <small>{{ deltaText() }}</small>
        </span>
        @if (s.favorite) {
          <i class="pi pi-star-fill tb-cell-favorite" aria-label="Favori"></i>
        }
      </article>
    } @else {
      <article
        class="tb-room tb-room-tile tb-tone-{{ r().state.tone }}" [class.tb-with-photo]="s.image != null"
        [style.--c]="tile().background" [style.--f]="tile().strong"
        [attr.data-flip]="s.id"
        data-vt="room-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
        [class.tb-press]="pressing()"
        (pointerdown)="press($event)" (contextmenu)="menu($event)"
      >
        <a [routerLink]="['/app/room', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        <button type="button" class="tb-room-tile-favori" [class.tb-fav-on]="s.favorite" [attr.aria-pressed]="s.favorite"
                [title]="s.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'" (click)="favorite.emit(s.id)">
          <i class="pi" [class.pi-star-fill]="s.favorite" [class.pi-star]="!s.favorite"></i>
        </button>
        @if (s.image != null) {
          <span class="tb-room-tile-photo"><tb-photo-img [roomId]="s.id" [version]="s.image" /></span>
        }
        <span class="tb-room-tile-nom" data-vt="room-name" [attr.data-vt-id]="s.id">{{ s.name }}</span>
        <span class="tb-room-tile-t tb-figures" data-vt="room-temp" [attr.data-vt-id]="s.id" [tbWatch]="s.temperature">{{ unit.t(s.temperature) }}<span>°</span></span>
        <span class="tb-room-tile-etat">
          @if (r().state.tone === 'stable') { Confortable } @else { <b>{{ homeState() }}</b> }
          @if (s.setpoint?.value != null) { · {{ unit.t(s.setpoint?.value) }}° }
        </span>
        @if (r().trend; as t) {
          <svg class="tb-room-tile-courbe" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <path class="tb-room-tile-aire" [attr.d]="t.area" /><path class="tb-room-tile-ligne" [attr.d]="t.row" />
          </svg>
        }
      </article>
    }
  `,
})
export class TbRoomCard {
  protected readonly unit = inject(UnitService);
  private readonly prefs = inject(PreferencesService);

  readonly r = input.required<RoomSummary>();
  readonly fresh = input(false);
  readonly favorite = output<number>();
  /** Held down: the overview of the room. */
  readonly overview = output<number>();

  private readonly platform = inject(PlatformService);
  /** Being held: the card sinks a little, to say something is coming. */
  protected readonly pressing = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  /** The overview opened: the click of the release must not open the room. */
  private swallowed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // Caught on the way down, before the link of the card sees it
    (inject(ElementRef).nativeElement as HTMLElement).addEventListener('click', (e) => this.click(e), { capture: true });
  }

  protected press(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.tb-room-tile-favori')) return;
    this.swallowed = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const target = e.currentTarget as HTMLElement;
    const cancel = () => {
      clearTimeout(this.timer);
      this.pressing.set(false);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', cancel);
      target.removeEventListener('pointercancel', cancel);
      target.removeEventListener('pointerleave', cancel);
      removeEventListener('scroll', cancel, true);
    };
    // A finger that moves scrolls the page: not a long press
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', cancel);
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('pointerleave', cancel);
    addEventListener('scroll', cancel, { capture: true, passive: true });
    // Sinks only after a moment: a quick tap shows nothing
    this.timer = setTimeout(() => {
      this.pressing.set(true);
      this.timer = setTimeout(() => {
        cancel();
        this.swallowed = true;
        this.platform.vibrate(true);
        this.overview.emit(this.r().room.id);
      }, 330);
    }, 150);
  }

  protected click(e: MouseEvent): void {
    if (!this.swallowed) return;
    this.swallowed = false;
    e.preventDefault();
    e.stopPropagation();
  }

  /** The menu of the system (long press on a link) never shows over a card. */
  protected menu(e: Event): void {
    if (e instanceof PointerEvent && e.pointerType === 'mouse') return;
    e.preventDefault();
  }

  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  private readonly dark = computed(() => this.prefs.theme() === 'dark');

  protected readonly cellColor = computed(() => deltaColor(this.r().delta, this.dark(), this.prefs.tolerance()));
  protected readonly deltaText = computed(() => {
    const e = this.r().delta;
    if (e == null) return this.r().room.temperature == null ? 'pas de mesure' : 'sans consigne';
    return Math.abs(e) < 0.05 ? 'à la consigne' : this.unit.delta(e);
  });

  protected readonly tile = computed(() => {
    const s = this.r().room;
    const c = roomColor(s.temperature, s.setpoint?.value, this.prefs.homeColors(), this.prefs.tolerance());
    return { background: tintSoft(c, this.dark()), strong: tintStrong(c, this.dark()) };
  });
  protected readonly homeState = computed(() => ({ heating: 'Chauffe', hot: 'Un peu chaud', unknown: 'Pas de mesure', stable: 'Confortable' })[this.r().state.tone]);
}
