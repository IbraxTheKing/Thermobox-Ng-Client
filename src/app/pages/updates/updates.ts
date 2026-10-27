import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { UpdateNoticeService } from '../../core/update-notice';
import { long } from '../../core/dates';
import { markdownToHtml } from '../../core/markdown';
import { ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { UpdatesState, Preparation, AvailableVersion } from '../../models/models';
import { UpdateService } from '../../services/update.service';
import { TbSheet } from '../../ui/sheet';
import { updateTypeLabel } from '../../core/version';

/** A channel filter; [couleur] is the tb-channel-* class. */
interface ChannelChip {
  key: string;
  label: string;
  count: number;
  color: string;
}

/**
 * Updates (admin/updates.xhtml), ADMIN: version of the ThermoBox REST server, versions out on
 * GitHub, and their installation (checks, risks, backup), followed step by step.
 */
@Component({
  selector: 'tb-updates-page',
  imports: [NgTemplateOutlet, TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './updates.html',
})
export class UpdatesPage implements OnInit, OnDestroy {
  /** A tab of the Serveur page: no title of its own. */
  readonly embedded = input(false, { transform: booleanAttribute });

  private readonly api = inject(UpdateService);
  private readonly notice = inject(UpdateNoticeService);
  private readonly toasts = inject(ToastService);
  private readonly flip = inject(FlipService);

  protected readonly state = signal<UpdatesState | null>(null);
  protected readonly checking = signal(false);
  /** Channel chip picked ("rc", "beta", "nightly", "stable"), null for all. */
  protected readonly channelFilter = signal<string | null>(null);

  // Installation dialog
  protected readonly preparation = signal<Preparation | null>(null);
  protected readonly dialog = signal(false);
  protected readonly save = signal(true);
  protected readonly risksAccepted = signal(false);
  protected readonly launch = signal(false);

  private timer?: ReturnType<typeof setInterval>;
  /** The server restarts after installing: it stops answering for a while. */
  protected readonly restart = signal(false);

  /** The page polls while an installation runs. */
  protected readonly tracking = computed(() => {
    const s = this.state()?.installation?.state;
    return s === 'RUNNING' || s === 'RESTARTING';
  });

  protected readonly channelChips = computed<ChannelChip[]>(() => {
    const e = this.state();
    const all = e ? [...e.available, ...e.olderVersions] : [];
    const byKey = new Map<string, number>();
    for (const v of all) byKey.set(key(v), (byKey.get(key(v)) ?? 0) + 1);
    const order = ['alpha', 'beta', 'rc', 'nightly', 'stable'];
    return [...order, ...[...byKey.keys()].filter((k) => !order.includes(k)).sort()]
      .filter((k) => byKey.has(k))
      .map((k) => ({ key: k, label: label(k), count: byKey.get(k)!, color: color(k) }));
  });

  protected readonly available = computed(() => this.filtered(this.state()?.available ?? []));
  protected readonly earlier = computed(() => this.filtered(this.state()?.olderVersions ?? []));

  async ngOnInit(): Promise<void> {
    await this.refresh(false);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async refresh(quiet: boolean): Promise<void> {
    try {
      this.state.set(await firstValueFrom(this.api.state(quiet)));
      this.restart.set(false);
    } catch (e) {
      // While the server restarts on the new version
      if (this.tracking()) this.restart.set(true);
      else if (!quiet) this.toasts.error('Impossible de lire les mises à jour', errorMessage(e));
    }
    this.follow();
  }

  /** Every 2 s while an installation runs. */
  private follow(): void {
    clearInterval(this.timer);
    if (this.tracking()) this.timer = setInterval(() => void this.refresh(true), 2000);
  }

  protected filterChannel(c: string): void {
    this.flip.animate(() => this.channelFilter.update((x) => (x === c ? null : c)));
  }

  private filtered(l: AvailableVersion[]): AvailableVersion[] {
    return l.filter((v) => this.channelFilter() == null || key(v) === this.channelFilter());
  }

  protected async check(): Promise<void> {
    this.checking.set(true);
    try {
      const e = await firstValueFrom(this.api.check());
      this.state.set(e);
      this.notice.state.set(e);
      if (e.error) this.toasts.error('Vérification impossible', e.error);
      else if (e.updateAvailable) this.toasts.info('Nouvelle version disponible', e.available[0]?.version);
      else this.toasts.info('ThermoBox est à jour');
    } catch (err) {
      this.toasts.error('Vérification impossible', errorMessage(err));
    } finally {
      this.checking.set(false);
    }
  }

  protected async prepare(v: AvailableVersion): Promise<void> {
    try {
      const p = await firstValueFrom(this.api.prepare(v.version));
      this.preparation.set(p);
      // A corrective doesn't touch the database: the backup is offered, not ticked
      this.save.set(p.backupRequired);
      this.risksAccepted.set(false);
      this.dialog.set(true);
    } catch (e) {
      this.toasts.error('Version indisponible', errorMessage(e));
      await this.refresh(true);
    }
  }

  protected async install(): Promise<void> {
    const p = this.preparation();
    if (!p) return;
    this.launch.set(true);
    try {
      await firstValueFrom(this.api.install(p.version.version, this.save() || p.backupRequired, this.risksAccepted()));
      this.toasts.info(`Installation de ${p.version.version} lancée`, 'Le déroulement s’affiche ci-dessous.');
      this.dialog.set(false);
    } catch (e) {
      this.toasts.error('Installation impossible', errorMessage(e));
    } finally {
      this.launch.set(false);
    }
    await this.refresh(true);
  }

  // ---------------------------------------------------------------- formats

  protected notes = markdownToHtml;
  protected date = (iso: string | null | undefined) => long(iso ?? null);
  protected channel = (v: AvailableVersion) => color(key(v));
  protected channelLabel = (v: AvailableVersion) => label(key(v));

  protected checkIcon(level: string): string {
    return { OK: 'pi-check-circle', INFO: 'pi-info-circle', WARNING: 'pi-exclamation-triangle', BLOCKING: 'pi-ban' }[level] ?? 'pi-info-circle';
  }

  protected readonly typeLabel = updateTypeLabel;

  protected stepIcon(state: string): string {
    return { PENDING: 'pi-circle', RUNNING: 'pi-spin pi-spinner', OK: 'pi-check', SKIPPED: 'pi-minus', FAILED: 'pi-times' }[state] ?? 'pi-circle';
  }

  protected installationSeverity(state: string): string {
    return state === 'DONE' ? 'tb-tag-success' : state === 'FAILED' ? 'tb-tag-danger' : 'tb-tag-info';
  }

  protected installationLabel(state: string): string {
    return { RUNNING: 'En cours', RESTART: 'Redémarrage', DONE: 'Terminée', FAILED: 'Échec' }[state] ?? state;
  }

  protected componentLabel(c: string | null | undefined): string {
    return c === 'REST' ? 'Serveur REST' : c === 'JSF' ? 'Interface web' : (c ?? 'ThermoBox');
  }
}

function key(v: AvailableVersion): string {
  return v.prerelease ? v.channel || 'test' : 'stable';
}

/** Colour of a version: stable (green), alpha (blue), beta / rc (orange), nightly (violet). */
function color(c: string): string {
  return c === 'stable'
    ? 'stable'
    : c === 'alpha'
      ? 'alpha'
      : c === 'nightly'
        ? 'nightly'
        : 'test';
}

function label(c: string): string {
  return c === 'rc' ? 'RC' : c === 'nightly' ? 'Nightly' : c.charAt(0).toUpperCase() + c.slice(1);
}
