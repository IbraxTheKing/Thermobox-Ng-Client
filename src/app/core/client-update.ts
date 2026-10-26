import { Injectable, computed, signal } from '@angular/core';

import { VERSION_CLIENT, Version } from './version';

/** GitHub repository of this client, where its versions are published. */
export const CLIENT_REPOSITORY = 'IbraxTheKing/Thermobox-Ng-Client';

export interface PublishedClientVersion {
  version: Version;
  type: 'PATCH' | 'FEATURE';
  title: string;
  page: string;
  publishedOn: string | null;
}

/**
 * Versions of this client published on GitHub (releases of the repository), read directly from
 * the device, as the server does for itself (GitHubReleases.kt): the latest version newer than
 * this one, stable, or also the prereleases when this client is one.
 * Once an hour at most (the GitHub API accepts 60 requests an hour without a token).
 */
@Injectable({ providedIn: 'root' })
export class ClientUpdateService {
  readonly installed = Version.read(VERSION_CLIENT);
  /** null: not read yet; []: nothing newer. */
  readonly available = signal<PublishedClientVersion[] | null>(null);
  readonly error = signal<string | null>(null);
  private last = 0;

  /** The newest, if any. */
  readonly latestAvailable = computed(() => this.available()?.[0] ?? null);

  async check(force = false): Promise<void> {
    if (!force && Date.now() - this.last < 3_600_000 && this.available()) return;
    this.last = Date.now();
    try {
      const r = await fetch(`https://api.github.com/repos/${CLIENT_REPOSITORY}/releases?per_page=50`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      if (r.status === 403 || r.status === 429) throw new Error('Limite de requêtes GitHub atteinte, réessayez plus tard');
      if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
      const releases = (await r.json()) as { tag_name: string; name: string | null; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null }[];
      const installed = this.installed;
      // A development or stable version only offers stable ones; a prerelease also offers the
      // newer prereleases ("prerelease" channel of the server)
      const hasPrereleases = installed?.isPrerelease === true;
      const list = releases
        .filter((x) => !x.draft)
        .map((x) => ({ x, v: Version.read(x.tag_name) }))
        .filter((e): e is { x: (typeof releases)[number]; v: Version } => e.v != null)
        .filter((e) => (hasPrereleases || !e.v.isPrerelease) && (!installed || e.v.compare(installed) > 0))
        .sort((a, b) => b.v.compare(a.v))
        .map((e) => ({ version: e.v, type: e.v.typeFrom(installed), title: e.x.name || e.x.tag_name, page: e.x.html_url, publishedOn: e.x.published_at }));
      this.available.set(list);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'GitHub injoignable');
    }
  }
}
