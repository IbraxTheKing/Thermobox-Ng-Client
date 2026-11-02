import { ChangeDetectionStrategy, Component, VERSION, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { App as AppNative } from '@capacitor/app';
import { firstValueFrom } from 'rxjs';

import { PlatformService } from '../../core/platform';
import { TbServerLogo } from '../../ui/server-logo';
import { ServerFeaturesService } from '../../services/server-features.service';
import { ServerService } from '../../core/api.config';
import { UpdatesState } from '../../models/models';
import { UpdateService } from '../../services/update.service';
import { ClientUpdateService } from '../../core/client-update';
import { COMMIT_CLIENT, VERSION_CLIENT } from '../../core/version';
import { AuthService } from '../../core/auth';
import { DesktopService } from '../../core/desktop';
import { TrPipe } from '../../ui/tr.pipe';

interface Link {
  name: string;
  detail: string;
  url: string;
  icon: string;
}

/**
 * À propos: the versions of what makes up ThermoBox here (this client, the REST server it talks
 * to, the JSF interface before 26.12), the GitHub repositories and the credits.
 */
@Component({
  selector: 'tb-about',
  imports: [TrPipe, TbServerLogo, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about.html',
})
export class AboutPage {
  private readonly updates = inject(UpdateService);
  private readonly platform = inject(PlatformService);
  protected readonly serverUrl = inject(ServerService);
  protected readonly features = inject(ServerFeaturesService);
  protected readonly desktop = inject(DesktopService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** From the login page (route data): no account, so no server to ask; a way back. */
  readonly standalone = input(false, { transform: booleanAttribute });

  protected back(): void {
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/login');
  }

  /** GitHub tag that was built (scripts/build.mjs), "dev" in development. */
  protected readonly versionClient = VERSION_CLIENT;
  protected readonly commitClient = COMMIT_CLIENT;
  protected readonly updateClient = inject(ClientUpdateService);
  protected readonly versionAngular = VERSION.full;
  protected readonly platformName = this.desktop.active
    ? `Application ${this.desktop.name()}`
    : { ios: 'iOS · Liquid Glass', android: 'Android · Material 3', web: $localize`Web` }[this.platform.platform];
  protected readonly native = this.platform.native;
  /** Version of the installed app (App Store / Play Store build), native app only. */
  protected readonly versionNative = signal<string | null>(null);

  protected readonly server = signal<UpdatesState | null>(null);
  protected readonly serverError = signal(false);

  /** 26.12 (API v2): the JSF interface is gone, nothing mentions it any more. */
  protected readonly jsf = computed(() => !this.features.v2());

  protected readonly repositories = computed<Link[]>(() => [
    {
      name: 'ThermoBox',
      detail: this.jsf() ? $localize`Serveur REST, interface JSF, base de données et boîtiers` : $localize`Serveur REST, base de données et boîtiers`,
      url: 'https://github.com/IbraxTheKing/ThermoBox',
      icon: 'pi-server',
    },
    {
      name: 'Thermobox-Ng-Client',
      detail: $localize`Ce client : web, PWA, iOS, Android, Windows, macOS et Linux`,
      url: 'https://github.com/IbraxTheKing/Thermobox-Ng-Client',
      icon: 'pi-mobile',
    },
  ]);

  protected readonly libraries = computed<{ name: string; role: string; url: string }[]>(() => [
    { name: $localize`Angular`, role: 'application', url: 'https://angular.dev' },
    { name: $localize`Capacitor`, role: $localize`applications iOS et Android`, url: 'https://capacitorjs.com' },
    { name: $localize`Tauri`, role: $localize`applications Windows, macOS et Linux`, url: 'https://tauri.app' },
    { name: 'Chart.js', role: 'courbes', url: 'https://www.chartjs.org' },
    { name: 'PrimeIcons', role: $localize`icônes`, url: 'https://primeng.org/icons' },
    { name: $localize`Manrope`, role: 'police (SIL Open Font License)', url: 'https://github.com/sharanda/manrope' },
    { name: 'Tailwind CSS', role: $localize`utilitaires de style`, url: 'https://tailwindcss.com' },
    { name: 'Kotlin, Jersey, Jetty, Jackson', role: $localize`serveur REST`, url: 'https://github.com/IbraxTheKing/ThermoBox' },
    ...(this.jsf() ? [{ name: $localize`Jakarta Faces et PrimeFaces`, role: 'interface JSF', url: 'https://www.primefaces.org' }] : []),
  ]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    void this.updateClient.check();
    // Not signed in (from the login page): no server to ask
    if (!this.auth.user()) {
      this.serverError.set(true);
      return;
    }
    try {
      this.server.set(await firstValueFrom(this.updates.state(true)));
    } catch {
      this.serverError.set(true);
    }
    if (this.native) {
      try {
        const info = await AppNative.getInfo();
        this.versionNative.set(`${info.version} (${info.build})`);
      } catch {
        /* web */
      }
    }
  }

  protected updateType(t: string): string {
    return t === 'PATCH' ? 'corrective' : 'fonctionnelle';
  }

  protected channel(c: string | undefined): string {
    return c === 'PRERELEASE' ? $localize`préversions` : 'stable';
  }
}
