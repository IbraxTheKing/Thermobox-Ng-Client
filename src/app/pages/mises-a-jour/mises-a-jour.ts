import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AvisMajService } from '../../core/avis-maj';
import { longue } from '../../core/dates';
import { markdownVersHtml } from '../../core/markdown';
import { ToastService } from '../../core/messages';
import { EtatMisesAJour, Preparation, VersionDisponible } from '../../models/models';
import { UpdateService } from '../../services/update.service';
import { TbSheet } from '../../ui/sheet';

/** A channel filter; [couleur] is the tb-canal-* class. */
interface ChipCanal {
  cle: string;
  libelle: string;
  nombre: number;
  couleur: string;
}

/**
 * Mises à jour (admin/updates.xhtml), ADMIN: version of the ThermoBox REST server, versions out on
 * GitHub, and their installation (checks, risks, backup), followed step by step.
 */
@Component({
  selector: 'tb-mises-a-jour',
  imports: [NgTemplateOutlet, TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mises-a-jour.html',
})
export class MisesAJourPage implements OnInit, OnDestroy {
  private readonly api = inject(UpdateService);
  private readonly avis = inject(AvisMajService);
  private readonly toasts = inject(ToastService);

  protected readonly etat = signal<EtatMisesAJour | null>(null);
  protected readonly verification = signal(false);
  /** Channel chip picked ("rc", "beta", "nightly", "stable"), null for all. */
  protected readonly canalFiltre = signal<string | null>(null);

  // Installation dialog
  protected readonly preparation = signal<Preparation | null>(null);
  protected readonly dialogue = signal(false);
  protected readonly sauvegarder = signal(true);
  protected readonly risquesAcceptes = signal(false);
  protected readonly lancement = signal(false);

  private minuterie?: ReturnType<typeof setInterval>;
  /** The server restarts after installing: it stops answering for a while. */
  protected readonly redemarrage = signal(false);

  /** The page polls while an installation runs. */
  protected readonly suivi = computed(() => {
    const s = this.etat()?.installation?.state;
    return s === 'EN_COURS' || s === 'REDEMARRAGE';
  });

  protected readonly chipsCanaux = computed<ChipCanal[]>(() => {
    const e = this.etat();
    const toutes = e ? [...e.available, ...e.olderVersions] : [];
    const parCle = new Map<string, number>();
    for (const v of toutes) parCle.set(cle(v), (parCle.get(cle(v)) ?? 0) + 1);
    const ordre = ['rc', 'beta', 'nightly', 'stable'];
    return [...ordre, ...[...parCle.keys()].filter((k) => !ordre.includes(k)).sort()]
      .filter((k) => parCle.has(k))
      .map((k) => ({ cle: k, libelle: libelle(k), nombre: parCle.get(k)!, couleur: couleur(k) }));
  });

  protected readonly disponibles = computed(() => this.filtrees(this.etat()?.available ?? []));
  protected readonly anterieures = computed(() => this.filtrees(this.etat()?.olderVersions ?? []));

  async ngOnInit(): Promise<void> {
    await this.rafraichir(false);
  }

  ngOnDestroy(): void {
    clearInterval(this.minuterie);
  }

  private async rafraichir(discret: boolean): Promise<void> {
    try {
      this.etat.set(await firstValueFrom(this.api.etat(discret)));
      this.redemarrage.set(false);
    } catch (e) {
      // While the server restarts on the new version
      if (this.suivi()) this.redemarrage.set(true);
      else if (!discret) this.toasts.error('Impossible de lire les mises à jour', messageErreur(e));
    }
    this.suivre();
  }

  /** Every 2 s while an installation runs. */
  private suivre(): void {
    clearInterval(this.minuterie);
    if (this.suivi()) this.minuterie = setInterval(() => void this.rafraichir(true), 2000);
  }

  protected filtrerCanal(c: string): void {
    this.canalFiltre.update((x) => (x === c ? null : c));
  }

  private filtrees(l: VersionDisponible[]): VersionDisponible[] {
    return l.filter((v) => this.canalFiltre() == null || cle(v) === this.canalFiltre());
  }

  protected async verifier(): Promise<void> {
    this.verification.set(true);
    try {
      const e = await firstValueFrom(this.api.verifier());
      this.etat.set(e);
      this.avis.etat.set(e);
      if (e.error) this.toasts.error('Vérification impossible', e.error);
      else if (e.updateAvailable) this.toasts.info('Nouvelle version disponible', e.available[0]?.version);
      else this.toasts.info('ThermoBox est à jour');
    } catch (err) {
      this.toasts.error('Vérification impossible', messageErreur(err));
    } finally {
      this.verification.set(false);
    }
  }

  protected async preparer(v: VersionDisponible): Promise<void> {
    try {
      const p = await firstValueFrom(this.api.preparer(v.version));
      this.preparation.set(p);
      // A corrective doesn't touch the database: the backup is offered, not ticked
      this.sauvegarder.set(p.backupRequired);
      this.risquesAcceptes.set(false);
      this.dialogue.set(true);
    } catch (e) {
      this.toasts.error('Version indisponible', messageErreur(e));
      await this.rafraichir(true);
    }
  }

  protected async installer(): Promise<void> {
    const p = this.preparation();
    if (!p) return;
    this.lancement.set(true);
    try {
      await firstValueFrom(this.api.installer(p.version.version, this.sauvegarder() || p.backupRequired, this.risquesAcceptes()));
      this.toasts.info(`Installation de ${p.version.version} lancée`, 'Le déroulement s’affiche ci-dessous.');
      this.dialogue.set(false);
    } catch (e) {
      this.toasts.error('Installation impossible', messageErreur(e));
    } finally {
      this.lancement.set(false);
    }
    await this.rafraichir(true);
  }

  // ---------------------------------------------------------------- formats

  protected notes = markdownVersHtml;
  protected date = (iso: string | null | undefined) => longue(iso ?? null);
  protected canal = (v: VersionDisponible) => couleur(cle(v));
  protected canalLabel = (v: VersionDisponible) => libelle(cle(v));

  protected iconeControle(niveau: string): string {
    return { OK: 'pi-check-circle', INFO: 'pi-info-circle', AVERTISSEMENT: 'pi-exclamation-triangle', BLOQUANT: 'pi-ban' }[niveau] ?? 'pi-info-circle';
  }

  protected iconeEtape(etat: string): string {
    return { EN_ATTENTE: 'pi-circle', EN_COURS: 'pi-spin pi-spinner', OK: 'pi-check', IGNOREE: 'pi-minus', ECHEC: 'pi-times' }[etat] ?? 'pi-circle';
  }

  protected severiteInstallation(etat: string): string {
    return etat === 'TERMINEE' ? 'tb-tag-success' : etat === 'ECHEC' ? 'tb-tag-danger' : 'tb-tag-info';
  }

  protected libelleInstallation(etat: string): string {
    return { EN_COURS: 'En cours', REDEMARRAGE: 'Redémarrage', TERMINEE: 'Terminée', ECHEC: 'Échec' }[etat] ?? etat;
  }

  protected libelleComposant(c: string | null | undefined): string {
    return c === 'REST' ? 'Serveur REST' : c === 'JSF' ? 'Interface web' : (c ?? 'ThermoBox');
  }
}

function cle(v: VersionDisponible): string {
  return v.prerelease ? v.channel || 'test' : 'stable';
}

/** Colour of a version: stable (green), test for beta / rc (orange), nightly (violet). */
function couleur(c: string): string {
  return c === 'stable' ? 'stable' : c === 'nightly' ? 'nightly' : 'test';
}

function libelle(c: string): string {
  return c === 'rc' ? 'RC' : c === 'nightly' ? 'Nightly' : c.charAt(0).toUpperCase() + c.slice(1);
}
