import { ChangeDetectionStrategy, Component, DOCUMENT, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';

import { AnimationsService } from './core/animations';
import { AuthService } from './core/auth';
import { KeyboardService } from './core/keyboard';
import { PlatformService } from './core/platform';
import { PreferencesService } from './core/preferences';
import { WindowColorService } from './core/window-color';
import { SeasonService } from './core/season';
import { NotificationService } from './core/notifications';
import { AccentService } from './core/accent';
import { ServerFeaturesService } from './services/server-features.service';
import { TbConfirm, TbToasts } from './ui/hosts';
import { TbDesktopChrome } from './ui/desktop-chrome';
import { DesktopService } from './core/desktop';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TbToasts, TbConfirm, TbDesktopChrome],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-desktop-chrome />
    <router-outlet />
    <tb-toasts />
    <tb-confirm />
  `,
})
export class App {
  constructor() {
    // Theme, platform and shortcuts apply from the first page on
    inject(PreferencesService);
    inject(PlatformService);
    inject(KeyboardService);
    inject(AnimationsService);
    // Which API the server answers, its logo and limits
    inject(ServerFeaturesService);
    // The title bar of the installed app (and the browser bars) in the colour of the page
    // « Maison » on a holiday: its colour and what crosses the page
    inject(SeasonService).start();
    inject(AccentService).start();
    inject(WindowColorService).start();
    // Desktop app (Tauri): menu bar of macOS, links in the browser, the title bar of Windows
    inject(DesktopService).start();
    // Apps: notifications of the setpoint (Préférences turns them on)
    inject(NotificationService).start();
    // The pages of the app (its side bar, the Acrylic of Windows around it) or those around it
    // (login, adding an account while logged in, the new password): by the page shown, not by
    // being logged in
    const auth = inject(AuthService);
    const body = inject(DOCUMENT).body;
    const router = inject(Router);
    const inApp = signal(location.pathname.startsWith('/app'));
    router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) inApp.set(e.urlAfterRedirects.startsWith('/app'));
    });
    effect(() => {
      const app = auth.loggedIn() && inApp();
      body.classList.toggle('tb-app', app);
      body.classList.toggle('tb-public', !app);
    });
  }
}
