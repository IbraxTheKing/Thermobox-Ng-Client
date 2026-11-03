import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';

import { DesktopService } from '../../app/core/desktop';
import { PreferencesService } from '../../app/core/preferences';
import { TitleService } from '../../app/core/title';
import { TrPipe } from '../../app/ui/tr.pipe';
import { WindowsDesktopService, applyAcrylic } from './desktop.service';
import { WindowsSettings } from './settings';

/**
 * The frame of the Windows app, drawn by the page: the title bar of WinUI 3 (32 px, back and the
 * button of the side bar, the icon and the name on the left, the three caption buttons of Segoe
 * Fluent Icons on the right, close in red). The page scrolls under it, blurred. The pointer
 * resting on « maximize » opens the snap layouts of Windows 11. The scroll bar is the one of
 * WinUI too, over the page and under the title bar: the scroll bar of the page itself is hidden
 * (it ran along the title bar, and moved it when it appeared). The window takes the theme of the
 * page: the Acrylic of Windows 11 behind the side bar follows it.
 */
@Component({
  selector: 'tb-windows-titlebar',
  imports: [TrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
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
  `,
})
export class TbWindowsTitlebar {
  protected readonly desktop = inject(DesktopService) as WindowsDesktopService;
  protected readonly pageTitle = inject(TitleService);
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly settings = inject(WindowsSettings);
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
    // Préférences › Effets de transparence: the Acrylic and the blurred bars, or none (target.ts
    // did it at start)
    let first = true;
    effect(() => {
      const blur = this.settings.blur();
      if (first) {
        first = false;
        return;
      }
      void applyAcrylic(blur);
    });
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
