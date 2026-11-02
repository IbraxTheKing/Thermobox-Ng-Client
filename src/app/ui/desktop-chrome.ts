import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { Location, NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';

import { DesktopService, applyAcrylic } from '../core/desktop';
import { PreferencesService } from '../core/preferences';
import { TitleService } from '../core/title';
import { TrPipe } from './tr.pipe';

/**
 * The frame of the desktop app, drawn by the page:
 *
 * - Windows: the title bar of WinUI 3 (32 px, back and the button of the side bar, the icon and the name on the left, the three
 *   caption buttons of Segoe Fluent Icons on the right, close in red). The page scrolls under it,
 *   blurred. The pointer resting on « maximize » opens the snap layouts of Windows 11. The scroll
 *   bar is the one of WinUI too, over the page and under the title bar: the scroll bar of the page
 *   itself is hidden (it ran along the title bar, and moved it when it appeared). The window takes
 *   the theme of the page: the Acrylic of Windows 11 behind the side bar follows it.
 * - macOS: a strip to drag the window by, under the traffic lights (the page is under the title
 *   bar, tauri.macos.conf.json).
 * - Linux: the header bar of GNOME (libadwaita), drawn by the page in its colour (the colour of
 *   the page, its tint in « Maison »): back and the button of the side bar at the start, the name
 *   of the page in the middle, the buttons of the window where the desktop puts them
 *   (gtk-decoration-layout: main.rs, decoration_layout).
 */
@Component({
  selector: 'tb-desktop-chrome',
  imports: [TrPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (desktop.windows) {
      <header class="tb-titlebar" [class.tb-titlebar-scrolled]="scrolled()" [class.tb-titlebar-inactive]="!focused()" data-tauri-drag-region>
        <!-- As the TitleBar of WinUI 3: back, then the button of the side bar, on the left -->
        <button type="button" class="tb-titlebar-btn" tabindex="-1" i18n-aria-label aria-label="Retour" i18n-title title="Retour (Alt+Gauche)" [disabled]="!canGoBack()" (click)="back()">&#xE72B;</button>
        @if (inApp()) {
          <button type="button" class="tb-titlebar-btn tb-titlebar-pane" tabindex="-1" i18n-aria-label aria-label="Navigation" i18n-title title="Afficher ou réduire la navigation" (click)="desktop.togglePane()">&#xE700;</button>
        }
        <span class="tb-titlebar-icon" aria-hidden="true"></span>
        <span i18n class="tb-titlebar-title">Thermobox@if (pageTitle.title(); as t) {<span class="tb-titlebar-page"> · {{ t }}</span>}</span>
        <div class="tb-titlebar-buttons">
          <button type="button" class="tb-caption" tabindex="-1" i18n-aria-label aria-label="Réduire" i18n-title title="Réduire" (click)="desktop.minimize()">&#xE921;</button>
          <button type="button" class="tb-caption" tabindex="-1" [attr.aria-label]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)"
                  [title]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)"
                  (click)="maximize()" (pointerenter)="snapSoon()" (pointerleave)="snapCancel()">{{ desktop.maximized() ? '&#xE923;' : '&#xE922;' }}</button>
          <button type="button" class="tb-caption tb-caption-close" tabindex="-1" i18n-aria-label aria-label="Fermer" i18n-title title="Fermer" (click)="desktop.close()">&#xE8BB;</button>
        </div>
      </header>
      <!-- WinUI scroll bar: a thin line while scrolling, wider under the pointer -->
      <div class="tb-scrollbar" #track aria-hidden="true" [class.tb-scrollbar-on]="scrollable()" [class.tb-scrollbar-active]="active()"
           (pointerdown)="trackDown($event)">
        <span class="tb-scrollbar-thumb" [style.height.px]="thumbHeight()" [style.transform]="'translateY(' + thumbTop() + 'px)'"
              (pointerdown)="thumbDown($event)"></span>
      </div>
    } @else if (desktop.linux) {
      <header class="tb-headerbar" [class.tb-titlebar-scrolled]="scrolled()" [class.tb-headerbar-backdrop]="!focused()" data-tauri-drag-region
              (dblclick)="headerDoubleClick($event)">
        <div class="tb-hb-side tb-hb-start">
          @for (b of layout().start; track b) {
            <ng-container [ngTemplateOutlet]="windowButton" [ngTemplateOutletContext]="{ $implicit: b }" />
          }
          <button type="button" class="tb-hb-btn" tabindex="-1" i18n-aria-label aria-label="Retour" i18n-title title="Retour (Alt+Gauche)" [disabled]="!canGoBack()" (click)="back()"><i class="pi pi-arrow-left"></i></button>
          @if (inApp()) {
            <button type="button" class="tb-hb-btn tb-titlebar-pane" tabindex="-1" i18n-aria-label aria-label="Navigation" i18n-title title="Afficher ou réduire la navigation" (click)="desktop.togglePane()"><i class="pi pi-bars"></i></button>
          }
        </div>
        <span class="tb-hb-title">{{ pageTitle.title() || 'Thermobox' }}</span>
        <div class="tb-hb-side tb-hb-end">
          @for (b of layout().end; track b) {
            <ng-container [ngTemplateOutlet]="windowButton" [ngTemplateOutletContext]="{ $implicit: b }" />
          }
        </div>
      </header>
      <ng-template #windowButton let-b>
        @switch (b) {
          @case ('minimize') {
            <button type="button" class="tb-hb-window" tabindex="-1" i18n-aria-label aria-label="Réduire" i18n-title title="Réduire" (click)="desktop.minimize()"><i class="pi pi-minus"></i></button>
          }
          @case ('maximize') {
            <button type="button" class="tb-hb-window" tabindex="-1" [attr.aria-label]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)"
                    [title]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)" (click)="maximize()">
              <i class="pi" [class.pi-window-maximize]="!desktop.maximized()" [class.pi-window-minimize]="desktop.maximized()"></i>
            </button>
          }
          @case ('close') {
            <button type="button" class="tb-hb-window" tabindex="-1" i18n-aria-label aria-label="Fermer" i18n-title title="Fermer" (click)="desktop.close()"><i class="pi pi-times"></i></button>
          }
        }
      </ng-template>
    } @else if (desktop.mac) {
      <div class="tb-mac-drag" data-tauri-drag-region aria-hidden="true"></div>
    }
  `,
})
export class TbDesktopChrome {
  protected readonly desktop = inject(DesktopService);
  protected readonly pageTitle = inject(TitleService);
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  /** In the app (not the login pages): the side bar is there. */
  protected readonly inApp = signal(location.pathname.startsWith('/app'));
  /** A page to go back to, in this window. */
  protected readonly canGoBack = signal(false);
  protected readonly scrolled = signal(false);
  protected readonly focused = signal(document.hasFocus());
  private snapTimer?: ReturnType<typeof setTimeout>;

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  protected readonly scrollable = signal(false);
  protected readonly active = signal(false);
  protected readonly thumbHeight = signal(0);
  protected readonly thumbTop = signal(0);
  private idle?: ReturnType<typeof setTimeout>;
  private frame = 0;

  constructor() {
    if (!this.desktop.windows && !this.desktop.linux) return;
    if (this.desktop.windows) {
      // Préférences › Flou: the Acrylic and the blurred bars, or none (prepareDesktop did it at start)
      let first = true;
      effect(() => {
        const blur = this.prefs.windowBlur();
        if (first) {
          first = false;
          return;
        }
        void applyAcrylic(blur);
      });
    } else {
      // Linux: the header bar is drawn, Linux need not give its own back (main.rs); where its
      // window buttons go
      void this.desktop.linuxChrome().then((layout) => layout && this.layout.set(parseLayout(layout)));
    }
    // The theme of the window: the user's, or the system's followed (the page then sees it change)
    effect(() => {
      const choice = this.prefs.themeChoice();
      const theme = this.prefs.theme();
      void this.desktop.windowTheme(choice, theme).catch(() => undefined);
    });
    const nav = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.inApp.set(e.urlAfterRedirects.startsWith('/app'));
        this.canGoBack.set(((history.state as { navigationId?: number } | null)?.navigationId ?? 1) > 1);
      }
    });
    // The title bar of index.html (before the client loaded) gives way to this one
    this.doc.getElementById('tb-boot-titlebar')?.remove();
    if (this.desktop.linux) {
      const onFocus = () => this.focused.set(true);
      const onBlur = () => this.focused.set(false);
      const onScroll = () => this.scrolled.set(scrollY > 2);
      addEventListener('focus', onFocus);
      addEventListener('blur', onBlur);
      addEventListener('scroll', onScroll, { passive: true });
      inject(DestroyRef).onDestroy(() => {
        nav.unsubscribe();
        removeEventListener('focus', onFocus);
        removeEventListener('blur', onBlur);
        removeEventListener('scroll', onScroll);
      });
      return;
    }
    const onScroll = () => {
      this.scrolled.set(scrollY > 2);
      this.doc.documentElement.classList.toggle('tb-win-scrolled', scrollY > 2);
      this.measure();
      this.wake();
    };
    const onFocus = () => this.focused.set(true);
    const onBlur = () => this.focused.set(false);
    const onResize = () => this.measure();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    addEventListener('focus', onFocus);
    addEventListener('blur', onBlur);
    // The page grows and shrinks as its content comes
    const size = new ResizeObserver(() => this.measure());
    size.observe(this.doc.body);
    this.measure();
    inject(DestroyRef).onDestroy(() => {
      nav.unsubscribe();
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onResize);
      removeEventListener('focus', onFocus);
      removeEventListener('blur', onBlur);
      size.disconnect();
    });
  }

  /** Linux: the buttons of the window at the start and at the end of the header bar. */
  protected readonly layout = signal<{ start: string[]; end: string[] }>({ start: [], end: ['minimize', 'maximize', 'close'] });

  /** Linux: a double click on the header bar maximizes, as GNOME does (not on its buttons). */
  protected headerDoubleClick(e: MouseEvent): void {
    if ((e.target as Element).closest('button')) return;
    void this.desktop.toggleMaximize();
  }

  protected back(): void {
    if (this.canGoBack()) this.location.back();
  }

  protected maximize(): void {
    this.snapCancel();
    void this.desktop.toggleMaximize();
  }

  /** As the native button: the layouts once the pointer has rested a moment on it. */
  protected snapSoon(): void {
    this.snapCancel();
    this.snapTimer = setTimeout(() => void this.desktop.snapLayouts(), 650);
  }

  protected snapCancel(): void {
    clearTimeout(this.snapTimer);
  }

  // ---------------------------------------------------------------- scroll bar

  /** Height of the track (the window under the title bar). */
  private trackHeight(): number {
    return this.track()?.nativeElement.clientHeight ?? innerHeight - 32;
  }

  private measure(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const total = this.doc.documentElement.scrollHeight;
      const view = innerHeight;
      const can = total > view + 1;
      this.scrollable.set(can);
      if (!can) return;
      const h = this.trackHeight();
      const thumb = Math.max(32, (view / total) * h);
      this.thumbHeight.set(thumb);
      this.thumbTop.set((scrollY / (total - view)) * (h - thumb));
    });
  }

  /** Shown while scrolling, then fades (WinUI « conscious » scroll bar). */
  private wake(): void {
    this.active.set(true);
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.active.set(false), 1200);
  }

  protected thumbDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const start = scrollY;
    const total = this.doc.documentElement.scrollHeight - innerHeight;
    const range = this.trackHeight() - this.thumbHeight();
    const move = (ev: PointerEvent) => {
      scrollTo({ top: start + ((ev.clientY - startY) / Math.max(1, range)) * total, behavior: 'instant' });
      this.wake();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** A click on the track: one screen up or down, as Windows. */
  protected trackDown(e: PointerEvent): void {
    const thumbAt = (this.track()?.nativeElement.getBoundingClientRect().top ?? 32) + this.thumbTop();
    scrollBy({ top: e.clientY < thumbAt ? -innerHeight * 0.9 : innerHeight * 0.9, behavior: 'smooth' });
  }
}

/** « appmenu:minimize,maximize,close » → the buttons before and after the title. */
function parseLayout(layout: string): { start: string[]; end: string[] } {
  const known = (part: string | undefined) => (part ?? '').split(',').map((b) => b.trim()).filter((b) => ['minimize', 'maximize', 'close'].includes(b));
  const [start, end] = layout.split(':');
  return { start: known(start), end: known(end) };
}
