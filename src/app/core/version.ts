/** Inscrits par scripts/construire.mjs (npm run build), « dev » / vide autrement (angular.json). */
declare const THERMOBOX_VERSION: string;
declare const THERMOBOX_COMMIT: string;

/** Version of this client: the GitHub tag that was built (26.11.0, 26.11.0-beta.2…), or "dev". */
export const VERSION_CLIENT: string = typeof THERMOBOX_VERSION === 'string' ? THERMOBOX_VERSION : 'dev';
/** Commit construit (7 caractères), vide si inconnu. */
export const COMMIT_CLIENT: string = typeof THERMOBOX_COMMIT === 'string' ? THERMOBOX_COMMIT : '';

const RANKS: Record<string, number> = { nightly: 0, alpha: 1, beta: 2, rc: 3 };

/**
 * Version number of ThermoBox, same logic as the server (common/update/Version.kt):
 * `YY.MM.PATCH`, maybe followed by a prerelease (`-nightly.N`, `-beta.N`, `-rc.N`, or
 * `-nightly-N`), `v` prefix accepted. A monthly series (`26.11`): its versions are compatible with
 * each other, the update from one to another is a patch.
 */
export class Version {
  private constructor(
    readonly tag: string,
    readonly year: number,
    readonly month: number,
    readonly patch: number,
    /** nightly, beta, rc…; null for a stable version. */
    readonly prerelease: string | null,
    readonly prereleaseNumber: number,
  ) {}

  static read(tag: string | null | undefined): Version | null {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)[.-]?(\d+)?)?$/.exec(tag?.trim() ?? '');
    if (!m) return null;
    return new Version(tag!.trim(), +m[1], +m[2], +m[3], m[4]?.toLowerCase() ?? null, m[5] ? +m[5] : 0);
  }

  get isPrerelease(): boolean {
    return this.prerelease != null;
  }

  /** stable, nightly, beta, rc… */
  get channel(): string {
    return this.prerelease ?? 'stable';
  }

  /** « 26.11 » */
  get series(): string {
    return `${this.year}.${String(this.month).padStart(2, '0')}`;
  }

  sameSeries(other: Version): boolean {
    return this.year === other.year && this.month === other.month;
  }

  /** Update from [installed]: a patch within the same series, a feature update otherwise. */
  typeFrom(installed: Version | null): 'PATCH' | 'FEATURE' {
    return installed && this.sameSeries(installed) ? 'PATCH' : 'FEATURE';
  }

  compare(o: Version): number {
    const d = this.year - o.year || this.month - o.month || this.patch - o.patch;
    if (d) return d;
    // A stable comes after all its prereleases
    if (this.prerelease == null || o.prerelease == null) return Number(this.prerelease == null) - Number(o.prerelease == null);
    return (
      (RANKS[this.prerelease] ?? 9) - (RANKS[o.prerelease] ?? 9) ||
      this.prerelease.localeCompare(o.prerelease) ||
      this.prereleaseNumber - o.prereleaseNumber
    );
  }
}
