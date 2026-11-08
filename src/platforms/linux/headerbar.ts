import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, effect, inject, signal } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';

import { AuthService } from '../../app/core/auth';
import { SEPARATOR, showMenu } from '../../app/core/context-menu';
import { DesktopService } from '../../app/core/desktop';
import { KeyboardService } from '../../app/core/keyboard';
import { OnboardingService } from '../../app/core/onboarding';
import { PreferencesService } from '../../app/core/preferences';
import { TitleService } from '../../app/core/title';
import { TrPipe } from '../../app/ui/tr.pipe';
import { LinuxDesktopService } from './desktop.service';

/** An entry of the main menu; null between two groups. */
interface MainMenuItem {
  id: string;
  label: string;
  action: () => unknown;
}

/**
 * The frame of the Linux app: the header bar of GNOME (libadwaita), drawn by the page in its
 * colour (the colour of the page, its tint in « Maison »): back and the button of the side bar at
 * the start, the name of the page in the middle, the buttons of the window where the desktop puts
 * them (gtk-decoration-layout: linux.rs, followed while the app runs).
 *
 * With the window of the system (Préférences › Fenêtre › GTK 3), nothing is drawn: its native
 * header bar shows the title of the page, back, the sidebar button and the main menu, as told
 * from here; what they ask comes back here.
 */
@Component({
  selector: 'tb-linux-headerbar',
  imports: [TrPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (!desktop.nativeChrome) {
      <!--
        The header bar of an AdwOverlaySplitView (GTK 4 / libadwaita), split in two:
        - over the sidebar (when it is shown): the name of the app in the middle, the main menu at the
          end (its menu is the native one of GTK: Préférences, Raccourcis, À propos, Se déconnecter);
        - over the page: the button that shows or hides the sidebar, back (only when there is
          somewhere to go back to), the name of the page in the middle, the main menu when the
          sidebar is hidden.
        The buttons of the window where the desktop puts them (gtk-decoration-layout).
        "deep": the whole bar moves the window, its buttons excepted; a double click maximizes.
      -->
      <header class="tb-headerbar" [class.tb-titlebar-scrolled]="scrolled()" [class.tb-headerbar-backdrop]="!focused()" [class.tb-hb-in-app]="inApp()" data-tauri-drag-region="deep">
        @if (inApp()) {
          <div class="tb-hb-pane" data-tauri-drag-region="deep">
            <div class="tb-hb-side tb-hb-start">
              @for (b of desktop.windowButtons().start; track b) {
                <ng-container [ngTemplateOutlet]="windowButton" [ngTemplateOutletContext]="{ $implicit: b }" />
              }
            </div>
            <span class="tb-hb-brand"><span class="tb-logo" aria-hidden="true"></span><span class="tb-hb-brand-name">Thermobox</span></span>
            <div class="tb-hb-side tb-hb-end">
              <ng-container [ngTemplateOutlet]="mainMenu" />
            </div>
          </div>
        }
        <div class="tb-hb-content" data-tauri-drag-region="deep">
          <div class="tb-hb-side tb-hb-start">
            <span class="tb-hb-content-start-buttons">
              @for (b of desktop.windowButtons().start; track b) {
                <ng-container [ngTemplateOutlet]="windowButton" [ngTemplateOutletContext]="{ $implicit: b }" />
              }
            </span>
            @if (inApp()) {
              <button type="button" class="tb-hb-btn tb-titlebar-pane tb-hb-sidebar-toggle" tabindex="-1" i18n-aria-label aria-label="Afficher la barre latérale" i18n-title title="Afficher la barre latérale" (click)="desktop.togglePane()">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor"/><rect x="2" y="3" width="4" height="10" rx="2" fill="currentColor"/></svg>
              </button>
            }
            @if (canGoBack()) {
              <button type="button" class="tb-hb-btn" tabindex="-1" i18n-aria-label aria-label="Retour" i18n-title title="Retour (Alt+Gauche)" (click)="back()">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            }
          </div>
          <span class="tb-hb-title">{{ pageTitle.title() || pageTitle.app() }}</span>
          <div class="tb-hb-side tb-hb-end">
            @if (inApp()) {
              <span class="tb-hb-content-menu"><ng-container [ngTemplateOutlet]="mainMenu" /></span>
            }
            @for (b of desktop.windowButtons().end; track b) {
              <ng-container [ngTemplateOutlet]="windowButton" [ngTemplateOutletContext]="{ $implicit: b }" />
            }
          </div>
        </div>
      </header>
      <ng-template #mainMenu>
        <button type="button" class="tb-hb-btn tb-hb-menu" tabindex="-1" i18n-aria-label aria-label="Menu principal" i18n-title title="Menu principal" aria-haspopup="menu" (click)="mainMenuClick($event)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </ng-template>
      <ng-template #windowButton let-b>
        @switch (b) {
          @case ('minimize') {
            <button type="button" class="tb-hb-window" tabindex="-1" i18n-aria-label aria-label="Réduire" i18n-title title="Réduire" (click)="desktop.minimize()">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 11.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          }
          @case ('maximize') {
            <button type="button" class="tb-hb-window" tabindex="-1" [attr.aria-label]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)"
                    [title]="desktop.maximized() ? ('Niveau inférieur' | tr) : ('Agrandir' | tr)" (click)="maximize()">
              @if (desktop.maximized()) {
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="6" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 4h4.3c.7 0 1.2.5 1.2 1.2V9.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
              } @else {
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
              }
            </button>
          }
          @case ('close') {
            <button type="button" class="tb-hb-window" tabindex="-1" i18n-aria-label aria-label="Fermer" i18n-title title="Fermer" (click)="desktop.close()">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          }
        }
      </ng-template>
    }
  `,
})
export class TbLinuxHeaderbar {
  protected readonly desktop = inject(DesktopService) as LinuxDesktopService;
  protected readonly pageTitle = inject(TitleService);
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly auth = inject(AuthService);
  private readonly keyboard = inject(KeyboardService);
  private readonly guide = inject(OnboardingService);
  /** In the app (not the login pages): the side bar is there. */
  protected readonly inApp = signal(location.pathname.startsWith('/app'));
  /** A page to go back to, in this window. */
  protected readonly canGoBack = signal(false);
  protected readonly scrolled = signal(false);
  protected readonly focused = signal(document.hasFocus());

  constructor() {
    // The header bar is drawn, Linux need not give its own back (main.rs); where its window
    // buttons go
    void this.desktop.linuxReady();
    if (this.desktop.nativeChrome) {
      effect(() => {
        const inApp = this.inApp();
        void this.desktop.setNativeChrome({
          title: this.pageTitle.title() || this.pageTitle.app(),
          back: { label: $localize`Retour`, shown: this.canGoBack() },
          sidebar: { label: $localize`Afficher la barre latérale`, shown: inApp },
          menuLabel: $localize`Menu principal`,
          menu: inApp ? this.menuItems().map((m) => (m ? { id: m.id, label: m.label } : { id: '', label: '' })) : [],
        });
      });
      this.desktop.onNative((what) => {
        if (what === 'back') this.back();
        else if (what === 'sidebar') this.desktop.togglePane();
        else {
          void this.menuItems()
            .find((m) => m?.id === what)
            ?.action();
        }
      });
    }
    // Maximized: the corners of the window straighten (linux.css)
    effect(() => {
      const root = this.doc.documentElement;
      if (this.desktop.maximized()) root.dataset['maximized'] = '';
      else delete root.dataset['maximized'];
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
  }

  /**
   * The main menu of a GNOME app (open-menu), a native menu of GTK under its button (or the
   * popover of the native header bar): Préférences, the keyboard shortcuts, À propos, logging out.
   */
  private menuItems(): (MainMenuItem | null)[] {
    return [
      { id: 'preferences', label: $localize`Préférences`, action: () => this.router.navigateByUrl('/app/preferences') },
      { id: 'shortcuts', label: $localize`Raccourcis clavier`, action: () => this.keyboard.help.set(true) },
      { id: 'guide', label: $localize`Revoir le guide de démarrage`, action: () => this.guide.start() },
      null,
      { id: 'about', label: $localize`À propos de Thermobox`, action: () => this.router.navigateByUrl('/app/about') },
      null,
      { id: 'logout', label: $localize`Se déconnecter`, action: () => this.auth.logout() },
    ];
  }

  protected mainMenuClick(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    void showMenu(
      this.menuItems().map((m) => (m ? { label: m.label, action: m.action } : SEPARATOR)),
      r.left,
      r.bottom + 4,
    );
  }

  protected back(): void {
    if (this.canGoBack()) this.location.back();
  }

  protected maximize(): void {
    void this.desktop.toggleMaximize();
  }
}
