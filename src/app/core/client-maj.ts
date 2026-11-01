import { Injectable, computed, signal } from '@angular/core';

import { VERSION_CLIENT, Version } from './version';

/** Dépôt GitHub de ce client, où ses versions sont publiées. */
export const DEPOT_CLIENT = 'IbraxTheKing/Thermobox-Ng-Client';

export interface VersionClientPubliee {
  version: Version;
  type: 'CORRECTIVE' | 'FONCTIONNELLE';
  titre: string;
  page: string;
  publieeLe: string | null;
}

/**
 * Versions de ce client publiées sur GitHub (releases du dépôt), lues directement depuis
 * l'appareil, comme le serveur le fait pour lui-même (GitHubReleases.kt) : la dernière version
 * plus récente que celle-ci, stable, ou aussi les prépublications quand ce client en est une.
 * Une fois par heure au plus (l'API de GitHub accepte 60 requêtes par heure sans jeton).
 */
@Injectable({ providedIn: 'root' })
export class ClientMajService {
  readonly installee = Version.lire(VERSION_CLIENT);
  /** null : pas encore lu ; [] : rien de plus récent. */
  readonly disponibles = signal<VersionClientPubliee[] | null>(null);
  readonly erreur = signal<string | null>(null);
  private derniere = 0;

  /** La plus récente, s'il y en a une. */
  readonly derniereDisponible = computed(() => this.disponibles()?.[0] ?? null);

  async verifier(force = false): Promise<void> {
    if (!force && Date.now() - this.derniere < 3_600_000 && this.disponibles()) return;
    this.derniere = Date.now();
    try {
      const r = await fetch(`https://api.github.com/repos/${DEPOT_CLIENT}/releases?per_page=50`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (r.status === 403 || r.status === 429) throw new Error('Limite de requêtes GitHub atteinte, réessayez plus tard');
      if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
      const releases = (await r.json()) as { tag_name: string; name: string | null; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null }[];
      const installee = this.installee;
      // Une version de développement ou stable ne propose que des stables ; une prépublication
      // propose aussi les prépublications plus récentes (canal « prerelease » du serveur)
      const avecPrereleases = installee?.estPrerelease === true;
      const liste = releases
        .filter((x) => !x.draft)
        .map((x) => ({ x, v: Version.lire(x.tag_name) }))
        .filter((e): e is { x: (typeof releases)[number]; v: Version } => e.v != null)
        .filter((e) => (avecPrereleases || !e.v.estPrerelease) && (!installee || e.v.compare(installee) > 0))
        .sort((a, b) => b.v.compare(a.v))
        .map((e) => ({ version: e.v, type: e.v.typeDepuis(installee), titre: e.x.name || e.x.tag_name, page: e.x.html_url, publieeLe: e.x.published_at }));
      this.disponibles.set(liste);
      this.erreur.set(null);
    } catch (e) {
      this.erreur.set(e instanceof Error ? e.message : 'GitHub injoignable');
    }
  }
}
