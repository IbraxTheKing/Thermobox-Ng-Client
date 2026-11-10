import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';

import { DesktopService } from '../../app/core/desktop';
import { PreferencesService } from '../../app/core/preferences';
import { TitleService } from '../../app/core/title';
import { MacDesktopService } from './desktop.service';
import { MacHistory } from './history';
import { MacSwipe } from './swipe';
import { TbMacSettingsTabs } from './settings-tabs';

/**
 * The frame of the macOS app, as the apps of the system (AppKit, NSSplitViewController and a
 * unified toolbar): the side bar from the top of the window, the traffic lights in its corner;
 * over the content, the toolbar: the button of the side bar, back and forward (⌘[ ⌘], the swipe
 * of the trackpad: main.rs), the name of the page once its own title has scrolled under it. Its
 * buttons are centred on the traffic lights, where AppKit drew them (target.ts). The settings
 * window has its tabs there instead (settings-tabs.ts). Two looks (macos.css): Liquid Glass on macOS 26 and up
 * (html[data-mac="tahoe"]: the side bar floats, the buttons are capsules of glass), the look of
 * macOS 11 to 15 before (html[data-mac="classic"]: the side bar in the vibrancy of the system,
 * the toolbar blurred with its line once the page scrolls under it).
 *
 * Behind the side bar is the material of the window (main.rs, mac.rs): the page paints the rest
 * (.tb-mac-canvas, around the hole of the side bar).
 */
@Component({
  selector: 'tb-mac-toolbar',
  imports: [TbMacSettingsTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <!-- The page around the side bar: the material of the system shows through the hole -->
    <div class="tb-mac-canvas" aria-hidden="true"><div class="tb-mac-hole"></div><div class="tb-mac-light"></div></div>
    <header
      class="tb-mac-toolbar"
      [class.tb-mac-scrolled]="scrolled()"
      [class.tb-mac-inactive]="!focused()"
      [class.tb-mac-in-app]="inApp()"
      data-tauri-drag-region="deep"
    >
      @if (inApp()) {
        <!-- Back and forward, as Finder and System Settings: one capsule (Liquid Glass) -->
        <div class="tb-mac-items" data-tauri-drag-region="deep">
          <button
            type="button"
            class="tb-mac-btn"
            tabindex="-1"
            [disabled]="!canGoBack()"
            i18n-aria-label
            aria-label="Précédent"
            i18n-title
            title="Précédent (⌘[)"
            (click)="back()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M10 2.75 4.75 8 10 13.25"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            class="tb-mac-btn"
            tabindex="-1"
            [disabled]="!canGoForward()"
            i18n-aria-label
            aria-label="Suivant"
            i18n-title
            title="Suivant (⌘])"
            (click)="forward()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M6 2.75 11.25 8 6 13.25"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      }
      @if (desktop.settingsWindow) {
        <tb-mac-settings-tabs />
      } @else {
        <span class="tb-mac-title" [class.tb-mac-title-on]="titleShown()">{{
          pageTitle.title() || pageTitle.app()
        }}</span>
      }
    </header>
    @if (inApp()) {
      <!-- sidebar.left: in the corner of the side bar, after the traffic lights when it is hidden -->
      <button
        type="button"
        class="tb-mac-btn tb-mac-sidebar-btn tb-titlebar-pane"
        tabindex="-1"
        [class.tb-mac-inactive]="!focused()"
        [attr.aria-label]="prefs.sidebarCollapsed() ? showLabel : hideLabel"
        [title]="prefs.sidebarCollapsed() ? showLabel : hideLabel"
        (click)="desktop.togglePane()"
      >
        <svg viewBox="0 0 18 16" aria-hidden="true">
          <rect
            x="1.25"
            y="1.75"
            width="15.5"
            height="12.5"
            rx="3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <path d="M6.5 2v12" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M3.25 5h1.6M3.25 7.25h1.6M3.25 9.5h1.6"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    }
  `,
})
export class TbMacToolbar {
  protected readonly desktop = inject(DesktopService) as MacDesktopService;
  protected readonly pageTitle = inject(TitleService);
  protected readonly prefs = inject(PreferencesService);
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected readonly showLabel = $localize`Afficher la barre latérale`;
  protected readonly hideLabel = $localize`Masquer la barre latérale`;

  /** In the app (not the login pages, not the settings window): the side bar is there. */
  protected readonly inApp = signal(this.isApp(location.pathname));
  private readonly history = inject(MacHistory);
  protected readonly canGoBack = this.history.canGoBack;
  protected readonly canGoForward = this.history.canGoForward;
  protected readonly scrolled = signal(false);
  /** The name of the page in the toolbar: once its title (h1) has gone under it. */
  protected readonly titleShown = signal(false);
  protected readonly focused = signal(document.hasFocus());

  constructor() {
    const root = this.doc.documentElement;
    // The settings window: its title always in the toolbar (it has no h1 of its own to follow)
    if (this.desktop.settingsWindow) this.titleShown.set(true);
    // The theme of the window, so the material (glass, vibrancy) and the traffic lights are in the
    // theme of the page: the user's, or the system's followed (the page then sees it change)
    effect(() => {
      const choice = this.prefs.themeChoice();
      const theme = this.prefs.theme();
      void this.desktop.windowTheme(choice, theme).catch(() => undefined);
    });
    const nav = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.inApp.set(this.isApp(e.urlAfterRedirects));
        // The new page starts at its top
        requestAnimationFrame(() => this.measure());
      }
    });
    // The window in the background: the symbols of the side bar grey (macos.css)
    effect(() => root.classList.toggle('tb-mac-blurred', !this.focused()));
    const onFocus = () => this.focused.set(true);
    const onBlur = () => this.focused.set(false);
    // Once per frame, not on every event of the scroll (each measure reads the layout)
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), this.measure()));
    };
    // ⌘[ and ⌘] : back and forward, as in the apps of the system
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      if (e.key === '[') {
        e.preventDefault();
        this.back();
      } else if (e.key === ']') {
        e.preventDefault();
        this.forward();
      }
    };
    addEventListener('focus', onFocus);
    addEventListener('blur', onBlur);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('keydown', onKey);
    // Full screen: no traffic lights, the toolbar starts at the edge (macos.css)
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        const follow = async () => {
          if (await w.isFullscreen()) root.dataset['fullscreen'] = '';
          else delete root.dataset['fullscreen'];
        };
        await follow();
        // Once the window stops changing size, not on every step of it (each asks Rust)
        let timer: ReturnType<typeof setTimeout> | undefined;
        unlisten = await w.onResized(() => {
          clearTimeout(timer);
          timer = setTimeout(() => void follow(), 150);
        });
      })
      .catch(() => undefined);
    // Two fingers on the trackpad: back and forward, the page following them (swipe.ts)
    if (!this.desktop.ownWindow) inject(MacSwipe).start();
    inject(DestroyRef).onDestroy(() => {
      nav.unsubscribe();
      unlisten?.();
      removeEventListener('focus', onFocus);
      removeEventListener('blur', onBlur);
      removeEventListener('scroll', onScroll);
      removeEventListener('keydown', onKey);
    });
  }

  private isApp(url: string): boolean {
    return !this.desktop.ownWindow && url.startsWith('/app');
  }

  private measure(): void {
    this.scrolled.set(scrollY > 1);
    if (this.desktop.ownWindow) return;
    const h1 = this.doc.querySelector('.tb-main .tb-page-title h1, .tb-main h1');
    // No title in the page: the name in the toolbar at once
    this.titleShown.set(!h1 || h1.getBoundingClientRect().bottom < 52);
  }

  protected back(): void {
    if (this.canGoBack()) this.location.back();
  }

  protected forward(): void {
    if (this.canGoForward()) this.location.forward();
  }
}
