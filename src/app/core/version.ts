/** Inscrits par scripts/construire.mjs (npm run build), « dev » / vide autrement (angular.json). */
declare const THERMOBOX_VERSION: string;
declare const THERMOBOX_COMMIT: string;

/** Version de ce client : le tag GitHub construit (26.11.0, 26.11.0-beta.2…), ou « dev ». */
export const VERSION_CLIENT: string = typeof THERMOBOX_VERSION === 'string' ? THERMOBOX_VERSION : 'dev';
/** Commit construit (7 caractères), vide si inconnu. */
export const COMMIT_CLIENT: string = typeof THERMOBOX_COMMIT === 'string' ? THERMOBOX_COMMIT : '';

const RANGS: Record<string, number> = { nightly: 0, alpha: 1, beta: 2, rc: 3 };

/**
 * Numéro de version de ThermoBox, même logique que le serveur (common/update/Version.kt) :
 * `AA.MM.PATCH`, éventuellement suivi d'une prépublication (`-nightly.N`, `-beta.N`, `-rc.N`,
 * ou `-nightly-N`), préfixe `v` accepté. Une série mensuelle (`26.11`) : ses versions sont
 * compatibles entre elles, la mise à jour de l'une à l'autre est corrective.
 */
export class Version {
  private constructor(
    readonly tag: string,
    readonly annee: number,
    readonly mois: number,
    readonly patch: number,
    /** nightly, beta, rc… ; null pour une version stable. */
    readonly prerelease: string | null,
    readonly numeroPrerelease: number,
  ) {}

  static lire(tag: string | null | undefined): Version | null {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)[.-]?(\d+)?)?$/.exec(tag?.trim() ?? '');
    if (!m) return null;
    return new Version(tag!.trim(), +m[1], +m[2], +m[3], m[4]?.toLowerCase() ?? null, m[5] ? +m[5] : 0);
  }

  get estPrerelease(): boolean {
    return this.prerelease != null;
  }

  /** stable, nightly, beta, rc… */
  get canal(): string {
    return this.prerelease ?? 'stable';
  }

  /** « 26.11 » */
  get serie(): string {
    return `${this.annee}.${String(this.mois).padStart(2, '0')}`;
  }

  memeSerie(autre: Version): boolean {
    return this.annee === autre.annee && this.mois === autre.mois;
  }

  /** Mise à jour depuis [installee] : corrective dans la même série, fonctionnelle sinon. */
  typeDepuis(installee: Version | null): 'CORRECTIVE' | 'FONCTIONNELLE' {
    return installee && this.memeSerie(installee) ? 'CORRECTIVE' : 'FONCTIONNELLE';
  }

  compare(o: Version): number {
    const d = this.annee - o.annee || this.mois - o.mois || this.patch - o.patch;
    if (d) return d;
    // Une stable vient après toutes ses prépublications
    if (this.prerelease == null || o.prerelease == null) return Number(this.prerelease == null) - Number(o.prerelease == null);
    return (
      (RANGS[this.prerelease] ?? 9) - (RANGS[o.prerelease] ?? 9) ||
      this.prerelease.localeCompare(o.prerelease) ||
      this.numeroPrerelease - o.numeroPrerelease
    );
  }
}
