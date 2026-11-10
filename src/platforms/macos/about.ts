import { Injector, VERSION } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

import { AuthService } from '../../app/core/auth';
import { ClientUpdateService } from '../../app/core/client-update';
import { COMMIT_CLIENT, VERSION_CLIENT } from '../../app/core/version';
import { UpdatesState } from '../../app/models/models';
import { ServerFeaturesService } from '../../app/services/server-features.service';
import { UpdateService } from '../../app/services/update.service';

/** A line of the credits (main.rs, mac::AboutLine). */
interface Line {
  text: string;
  link?: string;
  kind?: 'title' | 'muted';
}

/**
 * « À propos de Thermobox » on macOS: the About panel of the system (a window of AppKit, apart),
 * not a page. What the page shows elsewhere (about.ts) is in its credits: this client, a newer
 * version on GitHub, the server of the account, the repositories, who made it and with what. The
 * server and GitHub are asked first, for a second at most (the panel opens with what came).
 */
export async function showAbout(injector: Injector): Promise<void> {
  const auth = injector.get(AuthService);
  const client = injector.get(ClientUpdateService);
  const features = injector.get(ServerFeaturesService);
  const [server] = await Promise.all([
    auth.user()
      ? firstValueFrom(injector.get(UpdateService).state(true).pipe(timeout(1200))).catch(() => null)
      : Promise.resolve(null),
    Promise.race([client.check().catch(() => undefined), new Promise((r) => setTimeout(r, 1200))]),
  ]);

  const lines: Line[] = [{ text: $localize`La température de chaque salle, en un coup d'œil.`, kind: 'muted' }, { text: '' }];

  lines.push({ text: $localize`Client Thermobox`, kind: 'title' });
  lines.push({ text: `Application macOS · Angular ${VERSION.full}`, kind: 'muted' });
  const newer = client.latestAvailable();
  if (newer && client.installed) {
    lines.push({ text: $localize`Nouvelle version du client` + ` : ${newer.version.tag}`, link: newer.page });
  } else if (client.available() && client.installed) {
    lines.push({ text: $localize`Client à jour`, kind: 'muted' });
  }

  if (auth.user()) {
    lines.push({ text: '' }, { text: $localize`Serveur REST`, kind: 'title' });
    lines.push({ text: auth.serverName() ? `${auth.serverName()} · ${auth.address()}` : auth.address() });
    lines.push({ text: serverVersion(server), kind: 'muted' });
  }

  lines.push({ text: '' }, { text: $localize`Code source`, kind: 'title' });
  lines.push({ text: 'ThermoBox', link: 'https://github.com/IbraxTheKing/ThermoBox' });
  lines.push({ text: 'Thermobox-Ng-Client', link: 'https://github.com/IbraxTheKing/Thermobox-Ng-Client' });

  lines.push({ text: '' }, { text: $localize`Crédits`, kind: 'title' });
  lines.push({ text: $localize`ib · IbraxTheKing`, link: 'https://github.com/IbraxTheKing' });
  lines.push({ text: $localize`Conception et développement de ThermoBox`, kind: 'muted' }, { text: '' });
  const libraries: [string, string, string][] = [
    [$localize`Angular`, 'application', 'https://angular.dev'],
    [$localize`Tauri`, $localize`applications Windows, macOS et Linux`, 'https://tauri.app'],
    ['Chart.js', 'courbes', 'https://www.chartjs.org'],
    ['PrimeIcons', $localize`icônes`, 'https://primeng.org/icons'],
    [$localize`Manrope`, 'police (SIL Open Font License)', 'https://github.com/sharanda/manrope'],
    ['Tailwind CSS', $localize`utilitaires de style`, 'https://tailwindcss.com'],
    ['Kotlin, Jersey, Jetty, Jackson', $localize`serveur REST`, 'https://github.com/IbraxTheKing/ThermoBox'],
  ];
  if (!features.v2()) libraries.push([$localize`Jakarta Faces et PrimeFaces`, 'interface JSF', 'https://www.primefaces.org']);
  for (const [name, role, url] of libraries) lines.push({ text: `${name} — ${role}`, link: url });

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('about_panel', {
    info: {
      name: 'Thermobox',
      version: VERSION_CLIENT,
      build: COMMIT_CLIENT,
      copyright: $localize`ThermoBox est distribué sous licence MIT. © 2026 ib.`,
      lines,
    },
  });
}

function serverVersion(s: UpdatesState | null): string {
  if (!s) return $localize`Version non communiquée par le serveur`;
  const channel = s.channel === 'PRERELEASE' ? $localize`préversions` : 'stable';
  return `${s.installedVersion ?? 'sources'} · ${$localize`Canal`} ${channel}`;
}
