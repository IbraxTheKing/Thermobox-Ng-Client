import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, model, signal, viewChild } from '@angular/core';

import { PlatformService } from '../core/platform';
import { UnitService } from '../core/unit';

/** The arc covers 270°, from the bottom left to the bottom right. */
const START = -225;
const OPENING = 270;
const R = 120;
const C = 150;
/** − / + held: first repeat after this delay (ms), then faster and faster. */
const WAITING = 380;
const PACE = [150, 110, 80, 60];

/**
 * « Maison »: the setpoint as the dial of a thermostat. The temperature in its centre, the
 * setpoint as a knob on the arc, turned with a finger (or the arrows of the keyboard, or − / +,
 * which repeat when held). The arc spans the range people set at home (10-30 °C); the bounds of a
 * consigne still apply.
 *
 * While the setpoint is set, it becomes the big figure in the centre and the temperature goes
 * underneath; a line across the track always shows where the temperature is now (for everyone,
 * a VIEWER too, who sees the dial without its knob).
 *
 * Only the knob turns the dial: a finger that lands on the arc to scroll the page, or a click
 * beside it, changes nothing.
 *
 *   <tb-dial [temperature]="e.temperature" [consigne]="e.consigne?.value" [(valeur)]="nouvelle" [couleur]="c" />
 */
@Component({
  selector: 'tb-dial',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-dial" [class.tb-dial-grabbing]="input()" [style.--m]="color()">
      <svg #dial viewBox="0 0 300 300" aria-hidden="false">
        <path class="tb-dial-track" [attr.d]="track()" />
        @if (position() != null) {
          <!-- The filled part: the same path, drawn up to the setpoint (it slides, not jumps) -->
          <path class="tb-dial-arc" [attr.d]="track()" pathLength="270" [style.stroke-dasharray]="angle() + ' 1000'" />
        }
        @if (marker() != null) {
          <!-- Where the temperature is now, across the track: the gap to the setpoint at a glance -->
          <g class="tb-dial-marker" [style.transform]="'rotate(' + marker() + 'deg)'">
            <line [attr.x1]="innerEdge[0]" [attr.y1]="innerEdge[1]" [attr.x2]="outerEdge[0]" [attr.y2]="outerEdge[1]" />
          </g>
        }
        @if (editable() && position() != null) {
          <g class="tb-dial-handle" [style.transform]="'rotate(' + angle() + 'deg)'">
            <!-- A wider ring than the knob, easier to catch with a finger -->
            <circle class="tb-dial-grip" [attr.cx]="start[0]" [attr.cy]="start[1]" r="34" (pointerdown)="enter($event)" />
            <circle class="tb-dial-button" [attr.cx]="start[0]" [attr.cy]="start[1]" r="16"
                    role="slider" tabindex="0" aria-label="Consigne"
                    [attr.aria-valuemin]="unit.setpointMin()" [attr.aria-valuemax]="unit.setpointMax()" [attr.aria-valuenow]="value()"
                    [attr.aria-valuetext]="text(value()) + ' ' + unit.symbol()"
                    (pointerdown)="enter($event)"
                    (keydown.arrowup)="step(1, $event)" (keydown.arrowright)="step(1, $event)"
                    (keydown.arrowdown)="step(-1, $event)" (keydown.arrowleft)="step(-1, $event)" />
          </g>
        }
      </svg>
      <div class="tb-dial-center" [class.tb-dial-adjusting]="adjusting()">
        <!-- Being set: the figure is the setpoint asked for, the temperature goes underneath -->
        @if (adjusting()) {
          <small>Objectif</small>
          @for (v of [text(value())]; track v) {
            <b class="tb-figures tb-dial-target">{{ v }}<span>°</span></b>
          }
          <em>Il fait {{ unit.t(temperature()) }}°</em>
        } @else {
          <small>Il fait</small>
          <b class="tb-figures" [attr.data-vt]="vtId() != null ? 'room-temp' : null" [attr.data-vt-id]="vtId()">{{ unit.t(temperature()) }}<span>°</span></b>
          @if (setpoint() != null) {
            <em>Objectif {{ unit.t(setpoint()) }}°</em>
          } @else {
            <em>Pas d'objectif</em>
          }
        }
      </div>
    </div>
    @if (editable()) {
      <div class="tb-dial-step">
        <button type="button" [class.tb-held]="held() === -1" aria-label="Baisser la consigne"
                (pointerdown)="press(-1, $event)" (click)="click(-1, $event)"><i class="pi pi-minus"></i></button>
        <button type="button" [class.tb-held]="held() === 1" aria-label="Monter la consigne"
                (pointerdown)="press(1, $event)" (click)="click(1, $event)"><i class="pi pi-plus"></i></button>
      </div>
    }
  `,
})
export class TbDial {
  protected readonly unit = inject(UnitService);
  private readonly platform = inject(PlatformService);

  /** Celsius. */
  readonly temperature = input<number | null | undefined>(null);
  /** Current consigne, Celsius. */
  readonly setpoint = input<number | null | undefined>(null);
  /** The setpoint being set, in the unit of the Preferences page (as tb-stepper). */
  readonly value = model<number | null>(null);
  readonly editable = input(false);
  readonly color = input('var(--md-primary)');
  /** The page of a room: its temperature morphs from the tile of the dashboard. */
  readonly vtId = input<number | null>(null);

  private readonly dial = viewChild<ElementRef<SVGSVGElement>>('cadran');
  /** The knob is held: it follows the finger without easing. */
  protected readonly input = signal(false);
  /** − or + held down (repeating). */
  protected readonly held = signal<0 | 1 | -1>(0);
  private repeat?: ReturnType<typeof setTimeout>;

  /** Range of the arc, in the unit shown. */
  protected readonly low = computed(() => (this.unit.fahrenheit() ? 50 : 10));
  protected readonly high = computed(() => (this.unit.fahrenheit() ? 86 : 30));

  /** Value at the knob (the one being set, else the current setpoint), in the unit shown. */
  protected readonly position = computed(() => {
    const v = this.value() ?? (this.setpoint() != null ? this.unit.fromCelsius(this.setpoint()!) : null);
    return v == null ? null : Math.min(this.high(), Math.max(this.low(), v));
  });
  /** Degrees along the arc, 0-270. */
  protected readonly angle = computed(() => {
    const p = this.position();
    return p == null ? 0 : ((p - this.low()) / (this.high() - this.low())) * OPENING;
  });
  protected readonly modified = computed(() => {
    const c = this.setpoint();
    const v = this.value();
    return v != null && (c == null || Math.abs(this.unit.inputToCelsius(v) - c) >= 0.05);
  });
  /** The setpoint is being set (held, or turned away from the current one): it is the big figure. */
  protected readonly adjusting = computed(() => this.value() != null && (this.modified() || this.input() || this.held() !== 0));
  /** Degrees along the arc of the temperature now (the line across the track), null without it. */
  protected readonly marker = computed(() => {
    const t = this.temperature();
    if (t == null) return null;
    const v = Math.min(this.high(), Math.max(this.low(), this.unit.fromCelsius(t)));
    return ((v - this.low()) / (this.high() - this.low())) * OPENING;
  });

  /** The whole track, and the start of the arc (where the knob sits before it is rotated). */
  protected readonly track = computed(() => {
    const [x1, y1] = point(0);
    const [x2, y2] = point(OPENING);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 1 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  });
  protected readonly start = point(0);
  protected readonly innerEdge = point(0, R - 17);
  protected readonly outerEdge = point(0, R + 17);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected text(v: number | null): string {
    return v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected step(direction: number, e?: Event): void {
    e?.preventDefault();
    const step = this.unit.setpointStep();
    const v = this.value() ?? this.position() ?? (this.unit.fahrenheit() ? 68 : 20);
    this.set(Math.round((v + direction * step) / step) * step);
  }

  // ---------------------------------------------------------------- − / + held

  protected press(direction: 1 | -1, e: PointerEvent): void {
    if (e.button !== 0) return;
    this.release();
    this.step(direction);
    this.held.set(direction);
    const button = e.currentTarget as HTMLElement;
    const end = () => {
      this.release();
      button.removeEventListener('pointerup', end);
      button.removeEventListener('pointerleave', end);
      button.removeEventListener('pointercancel', end);
    };
    button.addEventListener('pointerup', end);
    button.addEventListener('pointerleave', end);
    button.addEventListener('pointercancel', end);
    let n = 0;
    const next = (delay: number) => {
      this.repeat = setTimeout(() => {
        const before = this.value();
        this.step(direction);
        // At a bound: nothing more to do
        if (this.value() === before) return this.release();
        n++;
        next(PACE[Math.min(PACE.length - 1, Math.floor(n / 4))]);
      }, delay);
    };
    next(WAITING);
  }

  /** Clicks from the keyboard (Enter, Space); a pointer already stepped on pointerdown. */
  protected click(direction: 1 | -1, e: MouseEvent): void {
    if (e.detail === 0) this.step(direction);
  }

  private release(): void {
    clearTimeout(this.repeat);
    this.held.set(0);
  }

  // ---------------------------------------------------------------- the knob

  /** Turned with the finger (or the mouse) along the arc, from the knob only. */
  protected enter(e: PointerEvent): void {
    const svg = this.dial()?.nativeElement;
    if (!svg || !this.editable() || e.button !== 0) return;
    const read = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 300 - C;
      const y = ((ev.clientY - r.top) / r.height) * 300 - C;
      // Angle from the start of the arc, clockwise
      let a = (Math.atan2(y, x) * 180) / Math.PI - START;
      a = ((a % 360) + 360) % 360;
      if (a > OPENING) a = a > OPENING + (360 - OPENING) / 2 ? 0 : OPENING;
      const step = this.unit.setpointStep();
      this.set(Math.round((this.low() + (a / OPENING) * (this.high() - this.low())) / step) * step);
    };
    e.preventDefault();
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    this.input.set(true);
    const move = (ev: PointerEvent) => read(ev);
    const end = () => {
      this.input.set(false);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', end);
      svg.removeEventListener('pointercancel', end);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  private set(v: number): void {
    const bound = Math.min(this.unit.setpointMax(), Math.max(this.unit.setpointMin(), v));
    if (bound !== this.value()) this.platform.vibrate();
    this.value.set(bound);
  }
}

/** Point of the arc [a] degrees from its start (at [rayon] from the centre). */
function point(a: number, radius = R): [number, number] {
  const r = ((START + a) * Math.PI) / 180;
  return [C + radius * Math.cos(r), C + radius * Math.sin(r)];
}
