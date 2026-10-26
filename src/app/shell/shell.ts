import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AndroidNativeService, NativeTab, nativeIcon } from '../core/android-native';
import { AuthService } from '../core/auth';
import { UpdateNoticeService } from '../core/update-notice';
import { KeyboardService } from '../core/keyboard';
import { ActivityService } from '../core/http';
import { PlatformService } from '../core/platform';
import { PreferencesService } from '../core/preferences';
import { TitleService } from '../core/title';
import { TransitionsService } from '../core/transitions';
import { SettingsService } from '../services/settings.service';
import { TbAccounts } from '../ui/accounts';
import { TbSheet } from '../ui/sheet';
import { Destination, lastTab, destinationsOf, barSlots } from './destinations';

/** The lens follows the finger once held this long (ms), or as soon as the finger slides. */
const LONG_PRESS = 220;
const SLIDE = 8;

/**
 * Frame of every page of a logged-in user (layout.xhtml of the JSF interface): navigation rail on
 * wide screens, bar at the bottom of phones with the top bar above the page, the page in between.
 * The top bar holds no action: the account and the other pages are behind the last tab (« Plus »,
 * or « Compte » when every page fits in the bar), as in native apps.
 *
 * Same markup everywhere; the platform (PlatformService) restyles it: Liquid Glass on iOS,
 * Material 3 on Android, the ThermoBox glass on the web.
 *
 * iOS: the lens of the tab bar can be held and slid from tab to tab, as in iOS 26; letting go
 * opens the tab under it.
 */
@Component({
  selector: 'tb-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TbSheet, TbAccounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  host: {
    class: 'tb-shell',
    '[class.tb-scrolled]': 'scrolled()',
    '[class.tb-scrolled-title]': 'titleHidden()',
    '[class.tb-compact]': 'compact()',
  },
})
export class Shell implements OnInit, OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly platform = inject(PlatformService);
  protected readonly notice = inject(UpdateNoticeService);
  protected readonly activity = inject(ActivityService);
  protected readonly title = inject(TitleService);
  protected readonly keyboard = inject(KeyboardService);
  private readonly settings = inject(SettingsService);
  private readonly transitions = inject(TransitionsService);

  private readonly dests = viewChild<ElementRef<HTMLElement>>('dests');

  protected readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** « Maison » look: the words and the short bar of a home. */
  protected readonly home = computed(() => this.prefs.style() !== 'panel');
  protected readonly destinations = computed(() => destinationsOf(this.auth, this.home()));
  /** Places of the bar of phones before « Plus ». */
  protected readonly inBar = computed(() => barSlots(this.home()));
  /** Some pages only fit behind the last tab: it is « Plus » rather than « Compte ». */
  protected readonly hasMore = computed(() => this.destinations().length > this.inBar());
  protected readonly last = computed(() => lastTab(this.home(), this.hasMore()));
  /** Phone held upright: the bar at the bottom, the last pages behind « Plus ». */
  protected readonly bottomBar = this.platform.bottomBar;

  /** « Plus » / « Compte » is the current tab. */
  protected readonly moreActive = computed(() => {
    const url = this.url().split('?')[0];
    if (['/app/more', '/app/profile', '/app/preferences', '/app/about'].some((u) => url.startsWith(u))) return true;
    return this.bottomBar() && this.destinations().slice(this.inBar()).some((d) => this.isActive(d));
  });

  // Scrolling (iOS / Android bars)
  protected readonly scrolled = signal(false);
  protected readonly titleHidden = signal(false);
  protected readonly compact = signal(false);
  private lastY = 0;
  private image = 0;
  private readonly onScrolling = () => {
    cancelAnimationFrame(this.image);
    this.image = requestAnimationFrame(() => this.measureScroll());
  };
  private readonly onResize = () => this.placeLens();
  private timer?: ReturnType<typeof setInterval>;

  // Lens held (iOS)
  protected readonly input = signal(false);
  /** « Changer de compte » (rail of wide screens; on phones: the Plus page). */
  protected readonly accounts = signal(false);
  /** Tab under the held lens. */
  protected readonly hovered = signal<string | null>(null);
  private press: { id: number; x: number; t: number; dx: number; vx: number; timer: ReturnType<typeof setTimeout> } | null = null;
  /** The click that ends a slide of the lens must not open the tab it started on. */
  private ignoreClick = false;

  /** Android app: the bar at the bottom is the native Material 3 one (core/android-natif.ts). */
  private readonly native = inject(AndroidNativeService);

  constructor() {
    if (this.native.active) {
      effect(() => {
        const dests = this.destinations();
        // Phone held upright: the bar at the bottom (the first pages, then « Plus »); tablet or
        // phone held sideways: the rail on the left with every page, as on a computer
        const rail = !this.bottomBar();
        const slots = rail ? Math.min(dests.length, 6) : this.inBar();
        const last = rail ? lastTab(this.home(), dests.length > slots) : this.last();
        const tabs: NativeTab[] = dests.slice(0, slots).map((d) => ({
          id: d.link,
          label: d.label,
          icon: nativeIcon(d.icon),
          badge: !!d.badge && this.notice.available(),
        }));
        tabs.push({
          id: '/app/more',
          label: last.label,
          icon: last.native,
          badge: (rail ? dests.length > slots : this.hasMore()) && this.notice.available(),
        });
        const active = dests.slice(0, slots).find((d) => this.isActive(d))?.link ?? (this.moreActive() ? '/app/more' : null);
        this.prefs.theme();
        this.native.configureBar(
          tabs,
          active,
          true,
          (id, repeated) => {
            // The tab again: back to its first page (« Plus » from À propos, Rooms from a
            // room…), as the web bar does; already there, back to the top
            const here = this.router.url.split(/[?#]/)[0];
            if (repeated && here === id) scrollTo({ top: 0, behavior: this.prefs.animate() ? 'smooth' : 'auto' });
            else void this.router.navigateByUrl(id);
          },
          rail ? 'rail' : 'bottom',
        );
      });
    }
    // The lens of the iOS tab bar follows the selected destination
    afterRenderEffect(() => {
      this.url();
      this.destinations();
      this.bottomBar();
      this.placeLens();
    });
  }

  ngOnInit(): void {
    // Capture phase: before the routerLink of the tab the slide started on
    queueMicrotask(() => this.dests()?.nativeElement.addEventListener('click', (e) => this.onBarClick(e), true));
    addEventListener('scroll', this.onScrolling, { passive: true });
    addEventListener('resize', this.onResize, { passive: true });
    this.settings.load().subscribe({ error: () => undefined });
    void this.notice.check();
    void this.auth.refreshUser().catch(() => undefined);
    this.timer = setInterval(() => void this.notice.check(), 3_600_000);
    this.transitions.withoutTransition();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.compact.set(false);
      this.transitions.withoutTransition();
      setTimeout(() => this.measureScroll(), 50);
    });
  }

  ngOnDestroy(): void {
    this.native.leave();
    removeEventListener('scroll', this.onScrolling);
    removeEventListener('resize', this.onResize);
    clearInterval(this.timer);
  }

  protected isActive(d: Destination): boolean {
    const url = this.url().split('?')[0];
    return url.startsWith(d.link) || (d.also ?? []).some((a) => url.startsWith(a));
  }

  protected onDestination(): void {
    this.platform.vibrate();
  }

  /** The side bar of computers: names and icons, or icons only (morphs where it can). */
  protected fold(): void {
    const change = () => this.prefs.sidebarCollapsed.update((r) => !r);
    const doc = this.doc as Document & { startViewTransition?: (f: () => void) => unknown };
    if (!doc.startViewTransition || !this.prefs.animate()) return change();
    doc.startViewTransition(() => {
      change();
      // Inside the callback: the snapshot must see the new width
      this.doc.documentElement.dataset['sidebar'] = this.prefs.sidebarCollapsed() ? 'collapsed' : 'full';
    });
  }

  protected logout(): void {
    void this.auth.logout();
  }

  private measureScroll(): void {
    const y = scrollY;
    this.scrolled.set(y > 4);
    const bar = this.doc.querySelector('.tb-topbar')?.getBoundingClientRect().bottom ?? 0;
    const h1 = this.doc.querySelector('.tb-page-title h1');
    this.titleHidden.set(!!h1 && h1.getBoundingClientRect().bottom < bar + 4);
    // iOS: the tab bar shrinks while scrolling down, comes back when scrolling up
    if (this.platform.ios) {
      if (y < 40) this.compact.set(false);
      else if (y > this.lastY + 6) this.compact.set(true);
      else if (y < this.lastY - 6) this.compact.set(false);
    }
    this.lastY = y;
  }

  /** Tabs shown in the bar, in order. */
  private tabs(dests: HTMLElement): HTMLElement[] {
    return [...dests.querySelectorAll<HTMLElement>('.tb-dest')].filter((t) => t.offsetParent !== null && getComputedStyle(t).display !== 'none');
  }

  protected placeLens(): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || this.input()) return;
    const active = dests.querySelector<HTMLElement>('.tb-dest.tb-dest-on');
    const visible = !!active && active.offsetParent !== null && getComputedStyle(active).display !== 'none';
    dests.classList.toggle('tb-a-active', visible);
    // Bar of phones: the lens is placed in tabs (index, count), not in pixels, so it stays on its
    // tab whatever the bar does (shrinking while scrolling, rotation…)
    dests.classList.toggle('tb-lens-rel', this.bottomBar());
    if (!active || !visible) return;
    if (this.bottomBar()) {
      const tabs = this.tabs(dests);
      dests.style.setProperty('--tb-l-n', `${tabs.length}`);
      dests.style.setProperty('--tb-l-i', `${tabs.indexOf(active)}`);
      return;
    }
    this.setLens(dests, active.offsetLeft, active.offsetTop, active.offsetWidth, active.offsetHeight);
  }

  private setLens(dests: HTMLElement, x: number, y: number, w: number, h: number): void {
    dests.style.setProperty('--tb-l-x', `${x}px`);
    dests.style.setProperty('--tb-l-y', `${y}px`);
    dests.style.setProperty('--tb-l-w', `${w}px`);
    dests.style.setProperty('--tb-l-h', `${h}px`);
  }

  // ---------------------------------------------------------------- lens held and slid (iOS)

  protected pressStart(e: PointerEvent): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || !this.platform.ios || !this.bottomBar() || e.button !== 0) return;
    if (!(e.target as Element).closest('.tb-dest')) return;
    this.pressEnd();
    this.press = {
      id: e.pointerId,
      x: e.clientX,
      t: e.timeStamp,
      dx: 0,
      vx: 0,
      timer: setTimeout(() => this.enter(e.clientX), LONG_PRESS),
    };
    dests.addEventListener('pointermove', this.onSlide);
    dests.addEventListener('pointerup', this.onRelease);
    dests.addEventListener('pointercancel', this.onCancel);
  }

  private readonly onSlide = (e: PointerEvent) => {
    const a = this.press;
    if (!a || e.pointerId !== a.id) return;
    const dt = Math.max(1, e.timeStamp - a.t);
    a.vx = (e.clientX - a.x - a.dx) / dt;
    a.dx = e.clientX - a.x;
    a.t = e.timeStamp;
    if (!this.input() && Math.abs(a.dx) > SLIDE) this.enter(e.clientX);
    if (this.input()) this.follow(e.clientX, a.vx);
  };

  private readonly onRelease = (e: PointerEvent) => {
    if (!this.press || e.pointerId !== this.press.id) return;
    const link = this.input() ? this.hovered() : null;
    this.pressEnd();
    if (!link) return;
    this.ignoreClick = true;
    setTimeout(() => (this.ignoreClick = false), 400);
    this.platform.vibrate();
    if (this.router.url.split('?')[0] !== link) void this.router.navigateByUrl(link);
  };

  private readonly onCancel = () => this.pressEnd();

  /** The lens lifts off the bar and follows the finger. */
  private enter(x: number): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || !this.press || this.input()) return;
    clearTimeout(this.press.timer);
    try {
      dests.setPointerCapture(this.press.id);
    } catch {
      /* pointer already gone */
    }
    dests.classList.add('tb-a-active');
    this.input.set(true);
    this.platform.vibrate();
    this.follow(x, 0);
  }

  private follow(x: number, speed: number): void {
    const dests = this.dests()?.nativeElement;
    if (!dests) return;
    const tabs = this.tabs(dests);
    if (!tabs.length) return;
    const box = dests.getBoundingClientRect();
    const n = tabs.length;
    // Position in tabs, between two while it slides
    const i = Math.min(Math.max((x - box.left) / (box.width / n) - 0.5, 0), n - 1);
    dests.style.setProperty('--tb-l-n', `${n}`);
    dests.style.setProperty('--tb-l-i', `${i}`);
    // Stretched in the direction it moves, like a drop
    dests.style.setProperty('--tb-l-stretch', `${Math.min(0.18, Math.abs(speed) * 0.12)}`);
    const link = tabs[Math.round(i)].dataset['link'] ?? null;
    if (link !== this.hovered()) {
      if (this.hovered() != null) this.platform.vibrate();
      this.hovered.set(link);
    }
  }

  private pressEnd(): void {
    const dests = this.dests()?.nativeElement;
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    dests?.removeEventListener('pointermove', this.onSlide);
    dests?.removeEventListener('pointerup', this.onRelease);
    dests?.removeEventListener('pointercancel', this.onCancel);
    dests?.style.setProperty('--tb-l-stretch', '0');
    if (this.input()) {
      this.input.set(false);
      this.hovered.set(null);
      // Back on the current tab (or the next one, once the page changes)
      requestAnimationFrame(() => this.placeLens());
    }
  }

  private onBarClick(e: MouseEvent): void {
    if (!this.ignoreClick) return;
    e.preventDefault();
    e.stopPropagation();
    this.ignoreClick = false;
  }
}
