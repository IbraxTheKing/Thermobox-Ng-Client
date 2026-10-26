import { Injectable, computed, inject } from '@angular/core';

import { PreferencesService } from './preferences';

const ONE_DECIMAL = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Temperatures in the unit chosen on the Preferences page (Unite / UniteBean of the JSF
 * interface). Everything is stored in Celsius: only display and entered values are converted.
 */
@Injectable({ providedIn: 'root' })
export class UnitService {
  private readonly prefs = inject(PreferencesService);

  readonly fahrenheit = computed(() => this.prefs.unit() === 'F');
  readonly symbol = computed(() => (this.fahrenheit() ? '°F' : '°C'));

  /** Bounds and step of a setpoint, in this unit (5 to 35 °C). */
  readonly setpointMin = computed(() => (this.fahrenheit() ? 41 : 5));
  readonly setpointMax = computed(() => (this.fahrenheit() ? 95 : 35));
  readonly setpointStep = computed(() => (this.fahrenheit() ? 1 : 0.5));

  /** Bounds of a raw temperature (-50 to 80 °C). */
  readonly minValue = computed(() => (this.fahrenheit() ? -58 : -50));
  readonly maxValue = computed(() => (this.fahrenheit() ? 176 : 80));

  fromCelsius(c: number): number {
    return this.fahrenheit() ? (c * 9) / 5 + 32 : c;
  }

  toCelsius(v: number): number {
    return this.fahrenheit() ? ((v - 32) * 5) / 9 : v;
  }

  /** Entered in this unit, stored in Celsius to the tenth. */
  inputToCelsius(v: number): number {
    return Math.round(this.toCelsius(v) * 10) / 10;
  }

  /** « 21,5 » (or « 70,7 » in Fahrenheit), « — » without a value. */
  t(celsius: number | null | undefined): string {
    return celsius == null || isNaN(celsius) ? '—' : ONE_DECIMAL.format(this.fromCelsius(celsius));
  }

  /** « 21,5 °C », « — » without a value. */
  withSymbol(celsius: number | null | undefined): string {
    return celsius == null ? '—' : `${this.t(celsius)} ${this.symbol()}`;
  }

  /** « +0,8° » for a difference in Celsius (no offset: +1 °C is +1,8 °F), empty without a value. */
  delta(d: number | null | undefined): string {
    if (d == null || isNaN(d)) return '';
    const v = this.fahrenheit() ? (d * 9) / 5 : d;
    const rounded = Math.round(v * 10) / 10;
    return `${rounded >= 0 ? '+' : '−'}${ONE_DECIMAL.format(Math.abs(rounded))}°`;
  }

  /** A value for an entry field in this unit, rounded to the step of a setpoint. */
  forInput(celsius: number): number {
    const v = this.fromCelsius(celsius);
    return this.fahrenheit() ? Math.round(v) : Math.round(v * 10) / 10;
  }
}

/** Parses « 21,5 » or « 21.5 »; null if it isn't a number. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}
