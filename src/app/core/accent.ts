import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { androidSystemAccent } from './android-native';

import { PreferencesService } from './preferences';

/**
 * Accent colour of the interface (Préférences): the ThermoBox green, a palette, or the accent
 * colour of the system. The palette recolours the page, its surfaces and the buttons, in light and
 * dark, in « Maison » and in the control-panel style: every token of colour is derived from one
 * hue and one chroma (OKLCH), so all accents keep the contrasts of the original.
 *
 * Nothing else changes: the colours of the states (stable, en chauffe, trop chaud), of the rooms
 * and of the curves keep their meaning.
 */
export type AccentChoice = 'default' | 'system' | string;

export interface Palette {
  id: string;
  label: string;
  /** OKLCH hue (degrees) and chroma of the buttons. */
  h: number;
  c: number;
}

/** The ThermoBox green, as shown in the list (it is the stylesheets' own colours). */
export const DEFAULT_SWATCH = '#2f6b58';

export const PALETTES: Palette[] = [
  { id: 'ocean', label: 'Océan', h: 250, c: 0.12 },
  { id: 'lagoon', label: 'Lagon', h: 205, c: 0.09 },
  { id: 'moss', label: 'Mousse', h: 130, c: 0.08 },
  { id: 'amber', label: 'Ambre', h: 70, c: 0.11 },
  { id: 'coral', label: 'Corail', h: 35, c: 0.13 },
  { id: 'rose', label: 'Rose', h: 355, c: 0.12 },
  { id: 'lavender', label: 'Lavande', h: 295, c: 0.12 },
  { id: 'slate', label: 'Ardoise', h: 255, c: 0.025 },
];

@Injectable({ providedIn: 'root' })
export class AccentService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private style: HTMLStyleElement | null = null;

  /** The accent colour of the system, as #rrggbb; null: the system gives none here. */
  readonly systemColor = signal<string | null>(null);
  /** The system gives its accent colour (browser AccentColor, Android 12+ app). */
  readonly systemAvailable = computed(() => this.systemColor() != null);
  /** Why not, for the Préférences page. */
  readonly systemWhy = Capacitor.getPlatform() === 'ios'
    ? "iOS ne donne pas sa couleur d'accent aux applications."
    : Capacitor.getPlatform() === 'android'
      ? "Couleurs du fond d'écran à partir d'Android 12."
      : "Ce navigateur ne donne pas la couleur d'accent du système (Firefox et Safari la donnent).";

  /** Hue and chroma shown, null for the ThermoBox colours. */
  readonly seed = computed<{ h: number; c: number } | null>(() => {
    const choice = this.prefs.accent();
    if (choice === 'system') {
      const hex = this.systemColor();
      if (!hex) return null;
      const [, c, h] = hexToOklch(hex);
      return { h, c };
    }
    const p = PALETTES.find((x) => x.id === choice);
    return p ? { h: p.h, c: p.c } : null;
  });

  start(): void {
    void this.readSystem();
    // The system accent may change while the app is in the background (wallpaper, settings)
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'visible') void this.readSystem();
    });
    effect(() => this.apply(this.seed()));
  }

  private async readSystem(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      this.systemColor.set(await androidSystemAccent());
      return;
    }
    if (!CSS.supports('color', 'AccentColor')) return;
    const probe = this.doc.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;color:AccentColor';
    this.doc.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number);
    probe.remove();
    this.systemColor.set(rgb && rgb.length >= 3 ? '#' + rgb.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('') : null);
  }

  private apply(seed: { h: number; c: number } | null): void {
    const root = this.doc.documentElement;
    if (!seed) {
      this.style?.remove();
      this.style = null;
      delete root.dataset['accent'];
      return;
    }
    if (!this.style) {
      this.style = this.doc.createElement('style');
      this.style.id = 'tb-accent';
      this.doc.head.appendChild(this.style);
    }
    this.style.textContent = accentCss(seed.h, seed.c);
    // Last: the window colour and the Android bars read the new colours on this change
    root.dataset['accent'] = `${Math.round(seed.h)}-${seed.c.toFixed(3)}`;
  }
}

/** The tokens of one accent, for the two looks, in light and dark. */
export function accentCss(h: number, chroma: number): string {
  const c = Math.min(0.15, Math.max(0.015, chroma));
  // Surfaces: a hint of the hue, less in the panel style (enamel)
  const s = Math.min(0.016, c * 0.13);
  const ok = (l: number, ch: number, a?: number) => `oklch(${l} ${ch.toFixed(4)} ${h.toFixed(1)}${a != null ? ` / ${a}` : ''})`;

  const light = (sc: number, outlineVariant: string) => `
    --tb-background: ${ok(0.944, sc)};
    --md-surface-container-lowest: ${ok(0.99, sc * 0.25)};
    --md-surface-container-low: ${ok(0.972, sc * 0.45)};
    --md-surface-container: ${ok(0.958, sc * 0.6)};
    --md-surface-container-high: ${ok(0.927, sc)};
    --md-surface-container-highest: ${ok(0.899, sc * 1.15)};
    --md-on-surface: ${ok(0.3, Math.min(0.03, c * 0.2))};
    --md-on-surface-variant: ${ok(0.51, Math.min(0.025, c * 0.15))};
    --md-outline: ${ok(0.65, Math.min(0.02, c * 0.12))};
    --md-outline-variant: ${outlineVariant};
    --md-inverse-surface: ${ok(0.3, Math.min(0.03, c * 0.2))};
    --md-inverse-on-surface: ${ok(0.958, sc * 0.6)};
    --md-primary: ${ok(0.47, c)};
    --md-on-primary: #ffffff;
    --md-primary-container: ${ok(0.9, c * 0.35)};
    --md-on-primary-container: ${ok(0.3, c * 0.75)};
    --md-inverse-primary: ${ok(0.8, c * 0.6)};
    --tb-glass: ${ok(0.976, sc * 0.4)};
    --tb-glass-hover: ${ok(0.99, sc * 0.25)};
    --tb-glass-solid: ${ok(0.976, sc * 0.4)};
    --tb-series-1: ${ok(0.47, c)};`;
  const dark = (sc: number, outlineVariant: string) => `
    --tb-background: ${ok(0.205, sc)};
    --md-surface-container-lowest: ${ok(0.175, sc * 0.9)};
    --md-surface-container-low: ${ok(0.228, sc)};
    --md-surface-container: ${ok(0.248, sc)};
    --md-surface-container-high: ${ok(0.285, sc * 1.1)};
    --md-surface-container-highest: ${ok(0.322, sc * 1.15)};
    --md-on-surface: ${ok(0.935, Math.min(0.012, c * 0.08))};
    --md-on-surface-variant: ${ok(0.75, Math.min(0.02, c * 0.12))};
    --md-outline: ${ok(0.6, Math.min(0.02, c * 0.12))};
    --md-outline-variant: ${outlineVariant};
    --md-inverse-surface: ${ok(0.935, Math.min(0.012, c * 0.08))};
    --md-inverse-on-surface: ${ok(0.248, sc)};
    --md-primary: ${ok(0.8, c * 0.7)};
    --md-on-primary: ${ok(0.27, c * 0.6)};
    --md-primary-container: ${ok(0.37, c * 0.5)};
    --md-on-primary-container: ${ok(0.91, c * 0.3)};
    --md-inverse-primary: ${ok(0.47, c)};
    --tb-glass: ${ok(0.248, sc)};
    --tb-glass-hover: ${ok(0.268, sc)};
    --tb-glass-solid: ${ok(0.248, sc)};
    --tb-series-1: ${ok(0.8, c * 0.7)};`;
  const panel = s * 0.6;
  return `
:root[data-accent] {${light(s, ok(0.3, Math.min(0.03, c * 0.2), 0.12))}
}
:root[data-accent][data-theme="dark"] {${dark(s * 0.8, 'rgba(255, 255, 255, .09)')}
}
:root[data-accent][data-style="panel"] {${light(panel, ok(0.82, panel))}
    --md-secondary-container: ${ok(0.927, panel)};
    --tb-glass-line: ${ok(0.82, panel)};
    --tb-field: ${ok(0.985, panel * 0.3)};
    --tb-field-line: ${ok(0.77, panel)};
    --tb-tile: ${ok(0.958, panel * 0.6)};
}
:root[data-accent][data-style="panel"][data-theme="dark"] {${dark(panel * 0.8, ok(0.33, panel))}
    --md-secondary-container: ${ok(0.285, panel)};
    --tb-glass-line: ${ok(0.33, panel)};
    --tb-field: ${ok(0.205, panel)};
    --tb-field-line: ${ok(0.4, panel)};
    --tb-tile: ${ok(0.285, panel)};
}`;
}

/** #rrggbb → OKLCH [lightness, chroma, hue in degrees]. */
export function hexToOklch(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255);
  const g = lin((n >> 8) & 255);
  const b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** A swatch for the Préférences page. */
export function swatch(p: { h: number; c: number }): string {
  return `oklch(0.55 ${Math.min(0.15, Math.max(0.015, p.c)).toFixed(3)} ${p.h})`;
}
