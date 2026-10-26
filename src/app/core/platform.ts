import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
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
 * or Chrome too). Exposed to the stylesheets as <html data-platform="…">.
 *
 * For development only, "?plateforme=ios|android|web" in the address forces one (kept until
 * "?plateforme=auto").
 */
export type Platform = 'ios' | 'android' | 'web';

const DEV_KEY = 'tb-platform-dev';

@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);

  readonly native = Capacitor.isNativePlatform();
  readonly platform: Platform = this.detect();
  readonly ios = this.platform === 'ios';
  readonly android = this.platform === 'android';

  /** Phone held upright: navigation in a bar at the bottom, top bar above the page. */
  private readonly barQuery = matchMedia('(max-width: 840px) and (not ((orientation: landscape) and (max-height: 520px)))');
  readonly bottomBar = signal(this.barQuery.matches);
  /** Phone-sized screen (≤ 640 px wide): lists instead of tables, sheets from the bottom. */
  private readonly phoneQuery = matchMedia('(max-width: 640px)');
  readonly phone = signal(this.phoneQuery.matches);

  constructor() {
    const root = this.doc.documentElement;
    root.dataset['platform'] = this.platform;
    this.barQuery.addEventListener('change', (e) => this.bottomBar.set(e.matches));
    this.phoneQuery.addEventListener('change', (e) => this.phone.set(e.matches));
    if (this.native) root.classList.add('tb-native');
    if (this.android) this.enableRipples();
    if (this.ios) this.enablePresses();
    if (this.native) {
      // Status bar over the page, its text in the colour of the theme
      effect(() => {
        const dark = this.prefs.theme() === 'dark';
        void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
        if (this.android) void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
      });
    }
  }

  /** A light tap of the phone (native app only): tabs, switches, favourite. */
  vibrate(strong = false): void {
    if (!this.native) return;
    void Haptics.impact({ style: strong ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => undefined);
  }

  private detect(): Platform {
    const force = this.forced();
    if (force) return force;
    if (this.native) {
      const p = Capacitor.getPlatform();
      return p === 'ios' || p === 'android' ? p : 'web';
    }
    const ua = navigator.userAgent;
    // iPadOS presents itself as a Mac, but a Mac has no touch screen
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'web';
  }

  private forced(): Platform | null {
    try {
      const p = new URLSearchParams(location.search).get('plateforme');
      if (p === 'auto') localStorage.removeItem(DEV_KEY);
      else if (p === 'ios' || p === 'android' || p === 'web') localStorage.setItem(DEV_KEY, p);
      const v = localStorage.getItem(DEV_KEY);
      return v === 'ios' || v === 'android' || v === 'web' ? v : null;
    } catch {
      return null;
    }
  }

  /** Material ripple where a button, a link or a destination is pressed. */
  private enableRipples(): void {
    this.doc.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.prefs.animate()) return;
        const target = (e.target as Element | null)?.closest?.(
          '.tb-btn, .tb-dest, .tb-icon-btn, .tb-segmented > button, .tb-drill-main, .tb-more-list > *, .tb-summary-chip, .tb-chip',
        ) as HTMLElement | null;
        if (!target || (target as HTMLButtonElement).disabled) return;
        const host = target.classList.contains('tb-dest') ? (target.querySelector('.tb-dest-icon') as HTMLElement) ?? target : target;
        const r = host.getBoundingClientRect();
        const size = Math.hypot(r.width, r.height) * 2;
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        const frame = this.doc.createElement('span');
        frame.className = 'tb-ripple-frame';
        const ripple = this.doc.createElement('span');
        ripple.className = 'tb-ripple-wave';
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - r.left - size / 2}px`;
        ripple.style.top = `${e.clientY - r.top - size / 2}px`;
        frame.appendChild(ripple);
        host.appendChild(frame);
        setTimeout(() => frame.remove(), 600);
      },
      { passive: true },
    );
  }

  /**
   * Liquid Glass (iOS 26): a pressed button swells and lights up under the finger (CSS:
   * .tb-press and --tb-px / --tb-py, motion.css).
   */
  private enablePresses(): void {
    let current: HTMLElement | null = null;
    const release = () => {
      current?.classList.remove('tb-press');
      current = null;
    };
    this.doc.addEventListener(
      'pointerdown',
      (e) => {
        release();
        if (!this.prefs.animate()) return;
        const target = (e.target as Element | null)?.closest?.(
          '.tb-btn, .tb-segmented > button, .tb-summary-chip, .tb-chip, .tb-list-row, .tb-mgmt-row',
        ) as HTMLElement | null;
        if (!target || (target as HTMLButtonElement).disabled) return;
        const r = target.getBoundingClientRect();
        target.style.setProperty('--tb-px', `${e.clientX - r.left}px`);
        target.style.setProperty('--tb-py', `${e.clientY - r.top}px`);
        if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
        target.classList.add('tb-press');
        current = target;
      },
      { passive: true },
    );
    for (const t of ['pointerup', 'pointercancel', 'dragstart', 'scroll']) this.doc.addEventListener(t, release, { passive: true, capture: true });
  }
}
