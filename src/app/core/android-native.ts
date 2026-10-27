import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { filter, take } from 'rxjs';

import { PreferencesService } from './preferences';
import { TransitionsService } from './transitions';

/** Tab of the native bar: id = address of the page, icon = name of a drawable of the plugin. */
export interface NativeTab {
  id: string;
  label: string;
  icon: string;
  badge?: boolean;
}

/** The bar at the bottom (phone held upright) or the rail on the left (tablet, phone sideways). */
export type BarMode = 'bottom' | 'rail';

/** #RRGGBB ou #AARRGGBB */
interface BarColors {
  background: string;
  normal: string;
  active: string;
  indicator: string;
  badge: string;
}

interface ThermoboxNativePlugin {
  configureBar(o: { tabs: NativeTab[]; active: string | null; visible: boolean; dark: boolean; colors: BarColors; mode: BarMode }): Promise<{ height: number; width?: number }>;
  selectTab(o: { id: string | null }): Promise<void>;
  showBar(o: { visible: boolean }): Promise<{ height: number; width?: number }>;
  configureFab(o: { visible: boolean; label?: string; icon?: string; extended?: boolean; colors?: { background: string; text: string } }): Promise<void>;
  expandFab(o: { extended: boolean }): Promise<void>;
  snackbar(o: { text: string; long?: boolean }): Promise<void>;
  confirm(o: { title: string; message: string; confirm?: string; cancel?: string; danger?: boolean }): Promise<{ value: boolean }>;
  menu(o: {
    title: string;
    subtitle: string;
    options: { id: string; label: string; icon: string; danger: boolean; checked?: boolean }[];
    colors: { background: string; text: string; secondaryText: string; danger: string; accent: string };
  }): Promise<{ id: string | null }>;
  addListener(e: 'tab', f: (d: { id: string; repeated: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'fab', f: () => void): Promise<PluginListenerHandle>;
  addListener(e: 'size', f: (d: { height: number; width?: number; visible: boolean }) => void): Promise<PluginListenerHandle>;
  enableBack(o: { active: boolean }): Promise<void>;
  addListener(e: 'back', f: (d: BackStep) => void): Promise<PluginListenerHandle>;
}

/** Android back, step by step (predictive gesture) or at once (button: "commit" only). */
interface BackStep {
  step: 'start' | 'progress' | 'cancel' | 'commit';
  /** 0 → 1 while the finger slides from the edge. */
  progress?: number;
  edge?: 'left' | 'right';
  /** Hauteur du doigt, px CSS. */
  y?: number;
}

/** Native Material 3 components (plugins/thermobox-native), in the Android app only. */
export const ANDROID_NATIVE =
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android' &&
  // Built into the app only when « npx cap sync » found it (npm install done): otherwise the page
  // keeps its own navigation bar, buttons and sheets rather than showing none.
  Capacitor.isPluginAvailable('ThermoboxNative');

if (Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform() && !ANDROID_NATIVE) {
  console.warn('Plugin ThermoboxNative absent de l\'application : npm install, puis npx cap sync android.');
}

const plugin = ANDROID_NATIVE ? registerPlugin<ThermoboxNativePlugin>('ThermoboxNative') : null;

/** PrimeIcons of the page → drawables of the plugin. */
const ICONS: Record<string, string> = {
  'pi-th-large': 'overview',
  'pi-building': 'rooms',
  'pi-chart-line': 'measurements',
  'pi-sliders-h': 'manage',
  'pi-users': 'users',
  'pi-cloud-download': 'updates',
  'pi-server': 'server',
  'pi-ellipsis-h': 'more',
  'pi-user': 'account',
  'pi-home': 'home',
  'pi-cog': 'settings',
  'pi-plus': 'add',
  'pi-user-plus': 'add_person',
  'pi-eye': 'view',
  'pi-external-link': 'open',
  'pi-pencil': 'edit',
  'pi-link': 'detach',
  'pi-trash': 'delete',
  'pi-key': 'key',
  'pi-arrow-right': 'move',
  'pi-star': 'star',
  'pi-star-fill': 'star',
};

export function nativeIcon(classes: string, fallback = 'add'): string {
  const pi = classes.split(/\s+/).find((c) => c in ICONS);
  return pi ? ICONS[pi] : fallback;
}

/** A theme colour (custom property, may be a color-mix) as #AARRGGBB, read by the browser. */
let probe: { el: HTMLElement; ctx: CanvasRenderingContext2D } | undefined;
function hex(...vars: string[]): string {
  probe ??= (() => {
    const el = document.createElement('span');
    el.style.display = 'none';
    document.body.appendChild(el);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return { el, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
  })();
  probe.el.style.color = vars.map((v) => `var(${v}`).join(', ') + ')'.repeat(vars.length);
  const computed = getComputedStyle(probe.el).color;
  probe.ctx.clearRect(0, 0, 1, 1);
  probe.ctx.fillStyle = '#000';
  probe.ctx.fillStyle = computed;
  probe.ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.ctx.getImageData(0, 0, 1, 1).data;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(a)}${h(r)}${h(g)}${h(b)}`;
}

/**
 * Sheets that are menus (TbSheet nativeMenu): a native Material bottom sheet, in the colours of
 * the page; the id of the row picked, null when it is dismissed.
 */
export const nativeMenu = plugin
  ? async (title: string, subtitle: string, options: { id: string; label: string; icon: string; danger: boolean; checked?: boolean }[]) =>
      (
        await plugin.menu({
          title,
          subtitle,
          // No icon (a list of choices): none drawn
          options: options.map((o) => ({ ...o, icon: o.icon ? nativeIcon(o.icon, 'open') : '' })),
          colors: {
            background: hex('--tb-m3-container-high', '--md-surface-container-high'),
            text: hex('--md-on-surface'),
            secondaryText: hex('--md-on-surface-variant'),
            danger: hex('--md-error'),
            accent: hex('--md-primary'),
          },
        })
      ).id
  : null;

/**
 * Native notifications and confirmations (snackbar, Material dialog): used by ToastService and
 * ConfirmService in the Android app; elsewhere the page keeps its own.
 */
export const nativeMessages = plugin
  ? {
      snackbar: (text: string, long: boolean) => void plugin.snackbar({ text, long }).catch(() => undefined),
      confirm: async (title: string, message: string, confirm: string, danger: boolean) =>
        (await plugin.confirm({ title, message, confirm, cancel: 'Annuler', danger })).value,
    }
  : null;

/**
 * Android app: the bottom navigation bar and the main action button of the pages are native
 * Material 3 components laid over the page (plugin ThermoboxNative); the page hides its own
 * (html.tb-android-native) and leaves at the bottom the room taken by the bar (--tb-nav-bottom).
 * The Android back button first closes what is open, then goes back, then puts the app in the
 * background.
 *
 * Elsewhere (web, iOS, PWA), nothing changes: the page draws everything.
 */
@Injectable({ providedIn: 'root' })
export class AndroidNativeService {
  private readonly doc = inject(DOCUMENT);
  private readonly root = this.doc.documentElement;
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);
  private readonly transitions = inject(TransitionsService);
  readonly active = ANDROID_NATIVE;

  /** Height of the native bar in CSS px (0: hidden). */
  readonly barHeight = signal(0);
  private keyboard = false;
  /** A sheet of the page is open: the native bar would cover its bottom (its buttons). */
  private sheet = false;
  private barWanted = false;
  private mode: BarMode = 'bottom';
  private fabTarget: HTMLElement | null = null;
  private fabConfig = '';
  private fabExtended = true;
  private lastY = 0;
  private onTab: ((id: string, repeated: boolean) => void) | null = null;
  private last: Parameters<AndroidNativeService['configureBar']> | null = null;
  /** What was sent to the bar: nothing is sent again when it did not change. */
  private sentBar = '';
  /** Back gesture in progress: what it will do, and the page following the finger. */
  private gesture: { mode: 'page' | 'autre'; main: HTMLElement | null; y0: number } | null = null;

  constructor() {
    if (!plugin) return;
    this.root.classList.add('tb-android-native');
    void plugin.addListener('tab', ({ id, repeated }) => this.onTab?.(id, repeated));
    void plugin.addListener('fab', () => this.fabTarget?.click());
    void plugin.addListener('size', ({ height, width }) => this.setHeight(height, width ?? 0));
    // Back: the plugin's (predictive gesture, Android 14+); the App plugin's only with an older
    // build of the plugin
    void App.addListener('backButton', () => this.back());
    void plugin.addListener('back', (e) => this.onBack(e));
    plugin.enableBack({ active: true }).catch(() => undefined);

    // Keyboard open (a field has the focus): the bar and the button make room
    this.doc.addEventListener('focusin', (e) => {
      if (this.isField(e.target)) this.keyboardOpen(true);
    });
    this.doc.addEventListener('focusout', () => setTimeout(() => this.keyboardOpen(this.isField(this.doc.activeElement)), 50));

    // The main action of each page: follows the page (and its tabs, its selection mode…)
    new MutationObserver(() => {
      this.followSheets();
      this.scheduleFab();
    }).observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    this.installSelects();
    addEventListener('scroll', () => this.onScrolling(), { passive: true });
    // Theme, colour of the state, look: the native parts take the new colours
    new MutationObserver(() => {
      if (this.last) this.configureBar(...this.last);
      this.fabConfig = '';
      this.scheduleFab();
    }).observe(this.root, { attributes: true, attributeFilter: ['data-theme', 'data-tone', 'data-style', 'data-tint', 'data-background'] });
  }

  /** Called by the shell whenever its tabs, the current page or the theme change. */
  configureBar(tabs: NativeTab[], activeId: string | null, visible: boolean, onTab: (id: string, repeated: boolean) => void, mode: BarMode = 'bottom'): void {
    if (!plugin) return;
    this.last = [tabs, activeId, visible, onTab, mode];
    this.onTab = onTab;
    this.barWanted = visible;
    this.mode = mode;
    // The bar leaves room for the keyboard and the sheets; the rail, on the side, stays
    const hidden = mode === 'bottom' && (this.keyboard || this.sheet);
    const o = { tabs, active: activeId, visible: visible && !hidden, dark: this.root.dataset['theme'] === 'dark', colors: this.barColors(), mode };
    const key = JSON.stringify(o);
    if (key === this.sentBar) return;
    this.sentBar = key;
    void plugin
      .configureBar(o)
      .then(({ height, width }) => this.setHeight(height, width ?? 0))
      .catch((e) => console.error('Barre native', e));
  }

  /** The shell is gone (logout): nothing native stays on screen. */
  leave(): void {
    if (!plugin) return;
    this.barWanted = false;
    this.onTab = null;
    this.last = null;
    this.sentBar = '';
    void plugin.showBar({ visible: false });
    void plugin.configureFab({ visible: false });
    this.fabConfig = '';
    this.setHeight(0);
  }

  /** Room taken by the bar at the bottom (h) or by the rail on the left (l), in CSS px. */
  private setHeight(h: number, l = 0): void {
    this.barHeight.set(h);
    if (h > 0) this.root.style.setProperty('--tb-nav-bottom', `${h}px`);
    else this.root.style.removeProperty('--tb-nav-bottom');
    // The page moves right of the native rail (its own rail is hidden: shell-android.css)
    if (l > 0) this.root.style.setProperty('--tb-rail', `${l}px`);
    else this.root.style.removeProperty('--tb-rail');
    this.root.classList.toggle('tb-rail-native', l > 0);
  }

  private isField(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el?.matches) return false;
    // Not a <select>: native list, no keyboard (installSelects)
    if (el.matches('textarea, [contenteditable="true"]')) return true;
    return el.matches('input') && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes((el as HTMLInputElement).type);
  }

  private keyboardOpen(open: boolean): void {
    if (!plugin || open === this.keyboard) return;
    this.keyboard = open;
    this.updateVisibility();
  }

  /** The bar and the button make room for the keyboard and for the sheets of the page. */
  private updateVisibility(): void {
    if (!plugin) return;
    if (this.barWanted) void plugin.showBar({ visible: !this.keyboard && !this.sheet });
    this.sentBar = '';
    this.fabConfig = '';
    this.scheduleFab();
  }

  /**
   * A sheet of the page opens (a form: setpoint, add, move…): it rises from the bottom of the
   * screen, where the native bar is drawn over the page; the bar steps aside while it is open,
   * as under a Material modal bottom sheet. Native menus (TbSheet nativeMenu) are not concerned.
   */
  private followSheets(): void {
    const open = !!this.doc.querySelector('.tb-scrim:not(.tb-sheet-native):not(.tb-scrim-closed)');
    if (open === this.sheet) return;
    this.sheet = open;
    this.updateVisibility();
  }

  // ---------------------------------------------------------------- <select>: native lists

  /**
   * The lists of the page (<select>) open as native Material lists (the same bottom sheet as the
   * menus, the current choice ticked) instead of the WebView's own popup. The page's <select>
   * no longer takes the touch (CSS: html.tb-selects-native); a tap on it opens the list.
   */
  private installSelects(): void {
    this.root.classList.add('tb-selects-native');
    this.doc.addEventListener(
      'click',
      (e) => {
        const select = this.selectUnder(e.clientX, e.clientY);
        if (!select) return;
        e.preventDefault();
        e.stopPropagation();
        void this.choose(select);
      },
      true,
    );
    // Keyboard (or accessibility): Enter or Space on the list
    this.doc.addEventListener(
      'keydown',
      (e) => {
        if (!(e.target instanceof HTMLSelectElement) || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        void this.choose(e.target);
      },
      true,
    );
  }

  private selectUnder(x: number, y: number): HTMLSelectElement | null {
    for (const s of this.doc.querySelectorAll('select')) {
      if (s.disabled || !s.offsetParent) continue;
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }

  private open = 0;
  private async choose(select: HTMLSelectElement): Promise<void> {
    if (!nativeMenu || this.open) return;
    const options = [...select.options].map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled && !o.hidden);
    if (!options.length) return;
    this.open++;
    try {
      const id = await nativeMenu(
        this.labelOf(select),
        '',
        options.map(({ o, i }) => ({ id: String(i), label: o.text.trim(), icon: '', danger: false, checked: o.selected })),
      );
      const i = id == null ? -1 : Number(id);
      if (i < 0 || i === select.selectedIndex) return;
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      this.open--;
    }
  }

  /** Title of the list: its label, else its aria-label. */
  private labelOf(select: HTMLSelectElement): string {
    const byId = select.id ? this.doc.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    const text = byId?.textContent ?? select.closest('label')?.textContent ?? select.getAttribute('aria-label') ?? select.closest('.tb-field')?.querySelector('.tb-label')?.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- main action

  private image = 0;
  private scheduleFab(): void {
    cancelAnimationFrame(this.image);
    this.image = requestAnimationFrame(() => this.updateFab());
  }

  /** The page's main action (.tb-page-head > .tb-fab) becomes the native button. */
  private updateFab(): void {
    if (!plugin) return;
    const web = this.doc.querySelector<HTMLElement>('.tb-page-head > .tb-fab');
    // Hidden while rows are ticked (Gestion), while typing, without the bar (landscape)
    // Beside a rail (wide screen) the action stays in the header of the page, as on a computer
    const visible = !!web && !web.hasAttribute('disabled') && !this.keyboard && !this.sheet && this.barWanted && this.mode === 'bottom' && !this.doc.querySelector('.tb-bar-on');
    const label = web?.textContent?.trim() ?? '';
    const icon = nativeIcon(web?.querySelector('.pi')?.className ?? '');
    const config = `${visible}|${label}|${icon}|${this.root.dataset['theme']}|${this.root.dataset['tone'] ?? ''}`;
    this.fabTarget = web;
    if (config === this.fabConfig) return;
    this.fabConfig = config;
    void plugin.configureFab(visible ? { visible, label, icon, extended: this.fabExtended, colors: this.fabColors() } : { visible: false });
  }

  /** Scrolling down shrinks the button to its icon, scrolling up brings its label back. */
  private onScrolling(): void {
    if (!plugin || !this.fabTarget) return;
    const y = scrollY;
    const extended = y < 40 ? true : y > this.lastY + 8 ? false : y < this.lastY - 8 ? true : this.fabExtended;
    this.lastY = y;
    if (extended === this.fabExtended) return;
    this.fabExtended = extended;
    void plugin.expandFab({ extended });
  }

  // ---------------------------------------------------------------- back button

  /**
   * Predictive back (Material 3): while the finger comes in from the edge, the page shrinks and
   * moves away from it (the bars stay); let go and it goes back, the room page flowing back into
   * its dashboard card (TransitionsService) from where the finger left it; cancelled, it springs
   * back. Something open (sheet, full-screen chart) or nothing to go back to: no shrinking.
   */
  private onBack(e: BackStep): void {
    switch (e.step) {
      case 'start': {
        this.finishGesture(false);
        const page = !this.toClose() && this.canReturn() && this.prefs.animate();
        const main = page ? this.doc.querySelector<HTMLElement>('.tb-main') : null;
        this.gesture = { mode: main ? 'page' : 'autre', main, y0: e.y ?? innerHeight / 2 };
        if (main) {
          main.style.transition = 'none';
          main.style.transformOrigin = `50% ${scrollY + innerHeight * 0.5 - main.offsetTop}px`;
          this.root.classList.add('tb-gesture-back');
        }
        break;
      }
      case 'progress': {
        const main = this.gesture?.main;
        if (!main) break;
        // Interpolated as Material's predictive back: up to 90 %, a little away from the edge,
        // following the finger up and down
        const p = easeOut(e.progress ?? 0);
        const direction = e.edge === 'right' ? -1 : 1;
        const dy = Math.max(-1, Math.min(1, ((e.y ?? this.gesture!.y0) - this.gesture!.y0) / innerHeight));
        main.style.transform = `translate(${direction * p * Math.max(0, innerWidth / 20 - 8)}px, ${dy * p * innerHeight * 0.05}px) scale(${1 - p * 0.1})`;
        break;
      }
      case 'cancel':
        this.finishGesture(true);
        break;
      case 'commit': {
        const main = this.gesture?.mode === 'page' ? this.gesture.main : null;
        this.gesture = null;
        if (main?.style.transform) {
          // Goes back from where the page is: the transition takes its picture there, the page is
          // put straight once the next one is in place (before its picture)
          this.router.events
            .pipe(
              filter((ev) => ev instanceof NavigationEnd || ev instanceof NavigationCancel || ev instanceof NavigationError),
              take(1),
            )
            .subscribe(() => this.transitions.afterUpdate(() => this.reset(main, false)));
          setTimeout(() => this.reset(main, false), 1500);
        } else if (main) {
          this.reset(main, false);
        }
        this.back();
        break;
      }
    }
  }

  private finishGesture(spring: boolean): void {
    const main = this.gesture?.main;
    this.gesture = null;
    if (main) this.reset(main, spring);
  }

  private reset(main: HTMLElement, spring: boolean): void {
    const finish = () => {
      main.style.transition = '';
      main.style.transformOrigin = '';
      this.root.classList.remove('tb-gesture-back');
    };
    if (!main.style.transform) {
      finish();
      return;
    }
    main.style.transition = spring ? 'transform .35s cubic-bezier(.2, 0, 0, 1)' : 'none';
    main.style.transform = '';
    if (spring) setTimeout(finish, 360);
    else finish();
  }

  /** Something the back closes before going back. */
  private toClose(): boolean {
    return !!this.doc.querySelector('.tb-scrim:not(.tb-scrim-closed), .tb-chart-full .tb-reading-full');
  }

  private canReturn(): boolean {
    const state = history.state as { navigationId?: number } | null;
    return !!state?.navigationId && state.navigationId > 1;
  }

  /** Android back: closes what is open, else goes back, else puts the app in the background. */
  private back(): void {
    const scrim = this.doc.querySelector<HTMLElement>('.tb-scrim');
    if (scrim) {
      scrim.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const full = this.doc.querySelector<HTMLElement>('.tb-chart-full .tb-reading-full');
    if (full) {
      full.click();
      return;
    }
    if (this.canReturn()) history.back();
    else void App.minimizeApp();
  }

  // ---------------------------------------------------------------- colours of the theme

  private barColors(): BarColors {
    return {
      background: this.hex('--tb-m3-container', '--md-surface-container'),
      normal: this.hex('--md-on-surface-variant'),
      active: this.hex('--tb-m3-on-indicator', '--md-on-secondary-container'),
      indicator: this.hex('--tb-m3-indicator', '--md-secondary-container'),
      badge: this.hex('--md-error'),
    };
  }

  private fabColors(): { background: string; text: string } {
    return { background: this.hex('--md-primary-container'), text: this.hex('--md-on-primary-container') };
  }

  private hex(...vars: string[]): string {
    return hex(...vars);
  }
}

/** Progress of the gesture as Material eases it: quick at first, then slower. */
function easeOut(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - x, 2);
}
