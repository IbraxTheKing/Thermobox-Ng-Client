import { ChangeDetectionStrategy, Component, VERSION, computed, inject, signal } from '@angular/core';
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
  imports: [TbServerLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about.html',
})
export class AboutPage {
  private readonly updates = inject(UpdateService);
  private readonly platform = inject(PlatformService);
  protected readonly serverUrl = inject(ServerService);
  protected readonly features = inject(ServerFeaturesService);

  /** GitHub tag that was built (scripts/build.mjs), "dev" in development. */
  protected readonly versionClient = VERSION_CLIENT;
  protected readonly commitClient = COMMIT_CLIENT;
  protected readonly updateClient = inject(ClientUpdateService);
  protected readonly versionAngular = VERSION.full;
  protected readonly platformName = { ios: 'iOS · Liquid Glass', android: 'Android · Material 3', web: 'Web' }[this.platform.platform];
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
      detail: this.jsf() ? 'Serveur REST, interface JSF, base de données et boîtiers' : 'Serveur REST, base de données et boîtiers',
      url: 'https://github.com/IbraxTheKing/ThermoBox',
      icon: 'pi-server',
    },
    {
      name: 'Thermobox-Ng-Client',
      detail: 'Ce client : web, PWA, iOS et Android',
      url: 'https://github.com/IbraxTheKing/Thermobox-Ng-Client',
      icon: 'pi-mobile',
    },
  ]);

  protected readonly libraries = computed<{ name: string; role: string; url: string }[]>(() => [
    { name: 'Angular', role: 'application', url: 'https://angular.dev' },
    { name: 'Capacitor', role: 'applications iOS et Android', url: 'https://capacitorjs.com' },
    { name: 'Chart.js', role: 'courbes', url: 'https://www.chartjs.org' },
    { name: 'PrimeIcons', role: 'icônes', url: 'https://primeng.org/icons' },
    { name: 'Manrope', role: 'police (SIL Open Font License)', url: 'https://github.com/sharanda/manrope' },
    { name: 'Tailwind CSS', role: 'utilitaires de style', url: 'https://tailwindcss.com' },
    { name: 'Kotlin, Jersey, Jetty, Jackson', role: 'serveur REST', url: 'https://github.com/IbraxTheKing/ThermoBox' },
    ...(this.jsf() ? [{ name: 'Jakarta Faces et PrimeFaces', role: 'interface JSF', url: 'https://www.primefaces.org' }] : []),
  ]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    void this.updateClient.check();
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
    return c === 'PRERELEASE' ? 'préversions' : 'stable';
  }
}
