import { ChangeDetectionStrategy, Component, VERSION, inject, signal } from '@angular/core';
import { App as AppNative } from '@capacitor/app';
import { firstValueFrom } from 'rxjs';

import { PlateformeService } from '../../core/plateforme';
import { ServeurService } from '../../core/api.config';
import { EtatMisesAJour } from '../../models/models';
import { UpdateService } from '../../services/update.service';
import paquet from '../../../../package.json';

interface Lien {
  nom: string;
  detail: string;
  url: string;
  icone: string;
}

/**
 * À propos: the versions of what makes up ThermoBox here (this client, the REST server it talks
 * to, the JSF interface), the GitHub repositories and the credits.
 */
@Component({
  selector: 'tb-a-propos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './a-propos.html',
})
export class AProposPage {
  private readonly updates = inject(UpdateService);
  private readonly plateforme = inject(PlateformeService);
  protected readonly serveurUrl = inject(ServeurService);

  protected readonly versionClient = paquet.version;
  protected readonly versionAngular = VERSION.full;
  protected readonly nomPlateforme = { ios: 'iOS · Liquid Glass', android: 'Android · Material 3', web: 'Web' }[this.plateforme.plateforme];
  protected readonly natif = this.plateforme.natif;
  /** Version of the installed app (App Store / Play Store build), native app only. */
  protected readonly versionNative = signal<string | null>(null);

  protected readonly serveur = signal<EtatMisesAJour | null>(null);
  protected readonly serveurErreur = signal(false);

  protected readonly depots: Lien[] = [
    {
      nom: 'ThermoBox',
      detail: 'Serveur REST, interface JSF, base de données et boîtiers',
      url: 'https://github.com/IbraxTheKing/ThermoBox',
      icone: 'pi-server',
    },
    {
      nom: 'Thermobox-Ng-Client',
      detail: 'Ce client : web, PWA, iOS et Android',
      url: 'https://github.com/IbraxTheKing/Thermobox-Ng-Client',
      icone: 'pi-mobile',
    },
  ];

  protected readonly bibliotheques: { nom: string; role: string; url: string }[] = [
    { nom: 'Angular', role: 'application', url: 'https://angular.dev' },
    { nom: 'Capacitor', role: 'applications iOS et Android', url: 'https://capacitorjs.com' },
    { nom: 'Chart.js', role: 'courbes', url: 'https://www.chartjs.org' },
    { nom: 'PrimeIcons', role: 'icônes', url: 'https://primeng.org/icons' },
    { nom: 'Manrope', role: 'police (SIL Open Font License)', url: 'https://github.com/sharanda/manrope' },
    { nom: 'Tailwind CSS', role: 'utilitaires de style', url: 'https://tailwindcss.com' },
    { nom: 'Kotlin, Jersey, Jetty, Jackson', role: 'serveur REST', url: 'https://github.com/IbraxTheKing/ThermoBox' },
    { nom: 'Jakarta Faces et PrimeFaces', role: 'interface JSF', url: 'https://www.primefaces.org' },
  ];

  constructor() {
    void this.charger();
  }

  private async charger(): Promise<void> {
    try {
      this.serveur.set(await firstValueFrom(this.updates.etat(true)));
    } catch {
      this.serveurErreur.set(true);
    }
    if (this.natif) {
      try {
        const info = await AppNative.getInfo();
        this.versionNative.set(`${info.version} (${info.build})`);
      } catch {
        /* web */
      }
    }
  }

  protected canal(c: string | undefined): string {
    return c === 'PRERELEASE' ? 'préversions' : 'stable';
  }
}
