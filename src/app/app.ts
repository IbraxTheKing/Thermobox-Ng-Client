import { ChangeDetectionStrategy, Component, DOCUMENT, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AnimationsService } from './core/animations';
import { AuthService } from './core/auth';
import { KeyboardService } from './core/keyboard';
import { PlatformService } from './core/platform';
import { PreferencesService } from './core/preferences';
import { ServerFeaturesService } from './services/server-features.service';
import { TbConfirm, TbToasts } from './ui/hosts';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TbToasts, TbConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
    const auth = inject(AuthService);
    const body = inject(DOCUMENT).body;
    effect(() => {
      body.classList.toggle('tb-app', auth.loggedIn());
      body.classList.toggle('tb-public', !auth.loggedIn());
    });
  }
}
