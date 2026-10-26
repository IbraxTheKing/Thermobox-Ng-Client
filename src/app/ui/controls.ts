import { ChangeDetectionStrategy, Component, Directive, ElementRef, booleanAttribute, computed, effect, inject, input, model, signal } from '@angular/core';

import { PlatformService } from '../core/platform';
import { PreferencesService } from '../core/preferences';
import { UnitService, parseNumber } from '../core/unit';

/** On / off switch (p:toggleSwitch), restyled per platform. */
@Component({
  selector: 'tb-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <button
      type="button"
      role="switch"
      class="tb-switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label() || null"
      [disabled]="disabled()"
      (click)="toggle()"
    ></button>
  `,
})
export class TbSwitch {
  private readonly platform = inject(PlatformService);
  readonly checked = model(false);
  readonly label = input('');
  readonly disabled = input(false, { transform: booleanAttribute });

  toggle(): void {
    this.checked.update((v) => !v);
    this.platform.vibrate();
  }
}

/** Setpoint stepper (p:spinner): − 20,5 °C +, in the unit of the Preferences page. */
@Component({
  selector: 'tb-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tb-stepper">
      <button type="button" [class.tb-held]="held() === -1" (pointerdown)="press(-1, $event)" (click)="click(-1, $event)" aria-label="Moins"><i class="pi pi-minus"></i></button>
      <input
        type="text"
        inputmode="decimal"
        [id]="inputId() || null"
        [value]="text()"
        (change)="enter($any($event.target).value)"
        (keydown.arrowup)="step(1); $event.preventDefault()"
        (keydown.arrowdown)="step(-1); $event.preventDefault()"
        [attr.aria-label]="'Consigne en ' + unit.symbol()"
      />
      <span class="tb-stepper-unit">{{ unit.symbol() }}</span>
      <button type="button" [class.tb-held]="held() === 1" (pointerdown)="press(1, $event)" (click)="click(1, $event)" aria-label="Plus"><i class="pi pi-plus"></i></button>
    </span>
  `,
})
export class TbStepper {
  protected readonly unit = inject(UnitService);
  private readonly platform = inject(PlatformService);
  /** In the unit of the Preferences page. */
  readonly value = model<number | null>(null);
  readonly inputId = input('');

  protected readonly text = computed(() => {
    const v = this.value();
    return v == null ? '' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });

  /** − or + held down: it repeats, faster and faster (as the dial of « Maison »). */
  protected readonly held = signal<0 | 1 | -1>(0);
  private repeat?: ReturnType<typeof setTimeout>;

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
        if (this.value() === before) return this.release();
        n++;
        next([150, 110, 80, 60][Math.min(3, Math.floor(n / 4))]);
      }, delay);
    };
    next(380);
  }

  /** Keyboard (Enter, Space): a pointer already stepped on pointerdown. */
  protected click(direction: 1 | -1, e: MouseEvent): void {
    if (e.detail === 0) this.step(direction);
  }

  private release(): void {
    clearTimeout(this.repeat);
    this.held.set(0);
  }

  protected step(direction: number): void {
    const step = this.unit.setpointStep();
    const v = this.value() ?? (this.unit.fahrenheit() ? 68 : 20);
    this.value.set(this.clamp(Math.round((v + direction * step) / step) * step));
    this.platform.vibrate();
  }

  protected enter(t: string): void {
    const n = parseNumber(t);
    this.value.set(n == null ? null : this.clamp(Math.round(n * 10) / 10));
  }

  private clamp(v: number): number {
    return Math.min(this.unit.setpointMax(), Math.max(this.unit.setpointMin(), v));
  }
}

/**
 * A value that changed during a refresh pulses once (tbWatch of the JSF interface):
 *   <span [tbWatch]="salle.temperature">…</span>
 */
@Directive({ selector: '[tbWatch]' })
export class TbWatch {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly prefs = inject(PreferencesService);
  readonly tbWatch = input<unknown>();
  private first = true;
  private before: unknown;

  constructor() {
    effect(() => {
      const v = this.tbWatch();
      if (!this.first && v !== this.before && this.prefs.animate()) {
        this.el.nativeElement.animate(
          [
            { transform: 'translateY(6px)', opacity: 0.2, filter: 'blur(3px)' },
            { transform: 'none', opacity: 1, filter: 'none' },
          ],
          { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
      this.first = false;
      this.before = v;
    });
  }
}

/** Password field with its eye (p:password toggleMask). */
@Component({
  selector: 'tb-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tb-password">
      <input
        class="tb-input"
        [type]="visible ? 'text' : 'password'"
        [id]="inputId()"
        [value]="value()"
        (input)="value.set($any($event.target).value)"
        [attr.autocomplete]="autocomplete()"
        [class.tb-invalid]="invalid()"
        [attr.aria-invalid]="invalid()"
        [required]="required()"
      />
      <button type="button" (click)="visible = !visible" [attr.aria-label]="visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
        <i class="pi" [class.pi-eye]="!visible" [class.pi-eye-slash]="visible"></i>
      </button>
    </span>
  `,
})
export class TbPassword {
  readonly value = model('');
  readonly inputId = input('');
  readonly autocomplete = input('current-password');
  readonly invalid = input(false);
  readonly required = input(false, { transform: booleanAttribute });
  protected visible = false;
}
