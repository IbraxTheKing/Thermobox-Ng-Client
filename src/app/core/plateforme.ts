import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

import { PreferencesService } from './preferences';

/**
 * Platform the app runs on, which decides the look of its navigation:
 * - ios: Liquid Glass (shell-ios.css)
 * - android: Material 3 (shell-android.css)
 * - web: the ThermoBox look of the JSF interface (shell.css)
 *
 * Detected once, automatically: the native platform in the iOS / Android app (Capacitor), the
 * user agent in a browser (an iPhone or an Android phone gets its platform's navigation in Safari
 * or Chrome too). Exposed to the stylesheets as <html data-plateforme="…">.
 *
 * For development only, "?plateforme=ios|android|web" in the address forces one (kept until
 * "?plateforme=auto").
 */
export type Plateforme = 'ios' | 'android' | 'web';

const CLE_DEV = 'tb-plateforme-dev';

@Injectable({ providedIn: 'root' })
export class PlateformeService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);

  readonly natif = Capacitor.isNativePlatform();
  readonly plateforme: Plateforme = this.detecter();
  readonly ios = this.plateforme === 'ios';
  readonly android = this.plateforme === 'android';

  constructor() {
    const root = this.doc.documentElement;
    root.dataset['plateforme'] = this.plateforme;
    if (this.natif) root.classList.add('tb-natif');
    if (this.android) this.activerOndes();
    if (this.natif) {
      // Status bar over the page, its text in the colour of the theme
      effect(() => {
        const sombre = this.prefs.theme() === 'dark';
        void StatusBar.setStyle({ style: sombre ? Style.Dark : Style.Light }).catch(() => undefined);
        if (this.android) void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
      });
    }
  }

  /** A light tap of the phone (native app only): tabs, switches, favourite. */
  vibrer(fort = false): void {
    if (!this.natif) return;
    void Haptics.impact({ style: fort ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => undefined);
  }

  private detecter(): Plateforme {
    const force = this.forcee();
    if (force) return force;
    if (this.natif) {
      const p = Capacitor.getPlatform();
      return p === 'ios' || p === 'android' ? p : 'web';
    }
    const ua = navigator.userAgent;
    // iPadOS presents itself as a Mac, but a Mac has no touch screen
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
  }

  private forcee(): Plateforme | null {
    try {
      const p = new URLSearchParams(location.search).get('plateforme');
      if (p === 'auto') localStorage.removeItem(CLE_DEV);
      else if (p === 'ios' || p === 'android' || p === 'web') localStorage.setItem(CLE_DEV, p);
      const v = localStorage.getItem(CLE_DEV);
      return v === 'ios' || v === 'android' || v === 'web' ? v : null;
    } catch {
      return null;
    }
  }

  /** Material ripple where a button, a link or a destination is pressed. */
  private activerOndes(): void {
    this.doc.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.prefs.animations() || this.prefs.mouvementReduit) return;
        const cible = (e.target as Element | null)?.closest?.(
          '.tb-btn, .tb-dest, .tb-icon-btn, .tb-segmented > button, .tb-drill-main, .tb-plus-liste > *, .tb-summary-chip, .tb-chip',
        ) as HTMLElement | null;
        if (!cible || (cible as HTMLButtonElement).disabled) return;
        const hote = cible.classList.contains('tb-dest') ? (cible.querySelector('.tb-dest-icon') as HTMLElement) ?? cible : cible;
        const r = hote.getBoundingClientRect();
        const taille = Math.hypot(r.width, r.height) * 2;
        if (getComputedStyle(hote).position === 'static') hote.style.position = 'relative';
        const cadre = this.doc.createElement('span');
        cadre.className = 'tb-ripple-cadre';
        const onde = this.doc.createElement('span');
        onde.className = 'tb-ripple-onde';
        onde.style.width = onde.style.height = `${taille}px`;
        onde.style.left = `${e.clientX - r.left - taille / 2}px`;
        onde.style.top = `${e.clientY - r.top - taille / 2}px`;
        cadre.appendChild(onde);
        hote.appendChild(cadre);
        setTimeout(() => cadre.remove(), 600);
      },
      { passive: true },
    );
  }
}
