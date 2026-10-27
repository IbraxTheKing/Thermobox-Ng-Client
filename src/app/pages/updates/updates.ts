import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, booleanAttribute, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { UpdateNoticeService } from '../../core/update-notice';
import { long } from '../../core/dates';
import { markdownToHtml } from '../../core/markdown';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { UpdatesState, Preparation, AvailableVersion } from '../../models/models';
import { UpdateService } from '../../services/update.service';
import { TbSheet } from '../../ui/sheet';
import { Version, updateTypeLabel } from '../../core/version';
import { Rollback, rollbackOf } from '../../core/release-notes';

/** A channel filter; [couleur] is the tb-channel-* class. */
interface ChannelChip {
  key: string;
  label: string;
  count: number;
  color: string;
}

/** The versions of one monthly series (« 26.11 »), the most recent first. */
interface Series {
  key: string;
  latest: AvailableVersion;
  others: AvailableVersion[];
  /** The series of the version installed. */
  installed: boolean;
  /** Older than the version installed: going back. */
  older: boolean;
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
  /** The last installation, once finished: its steps unfolded. */
  protected readonly installationOpen = signal(false);

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

  // ---------------------------------------------------------------- by series

  /** One card per monthly series (its most recent version), or every version. */
  protected readonly bySeries = signal(true);

  protected readonly series = computed<Series[]>(() => {
    const installed = Version.read(this.state()?.installedVersion);
    const groups = new Map<string, AvailableVersion[]>();
    for (const v of [...this.available(), ...this.earlier()]) {
      const k = Version.read(v.version)?.series ?? v.version;
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    return [...groups.entries()]
      .map(([k, l]) => {
        const sorted = [...l].sort((a, b) => compareTags(b.version, a.version));
        return { key: k, latest: sorted[0], others: sorted.slice(1), installed: installed?.series === k, older: sorted[0].older };
      })
      .sort((a, b) => compareTags(b.latest.version, a.latest.version));
  });

  // ---------------------------------------------------------------- going back

  /** What the notes of a version say about going back to an older one afterwards. */
  protected rollback(v: AvailableVersion): Rollback {
    return rollbackOf(v.notes);
  }

  /**
   * The notes of the version installed (the server does not list it): read from GitHub, once,
   * when there are older versions to judge. The server may give it itself (installedRollback).
   */
  private readonly installedNotes = signal<string | null>(null);
  private readonly installedRollback = computed<Rollback>(() => {
    const e = this.state();
    if (e?.installedRollback != null) return e.installedRollback ? 'yes' : 'no';
    return rollbackOf(e?.installedNotes ?? this.installedNotes());
  });

  /**
   * An older version that can no longer be installed: a version between it and the installed one
   * (included) says in its notes that there is no going back. Its tag, null if none.
   */
  protected blockedBy(v: AvailableVersion): string | null {
    const e = this.state();
    if (!e || !v.older) return null;
    const between = (e.olderVersions ?? []).filter((z) => compareTags(z.version, v.version) > 0).sort((a, b) => compareTags(a.version, b.version));
    const z = between.find((x) => rollbackOf(x.notes) === 'no');
    if (z) return z.version;
    return this.installedRollback() === 'no' ? e.installedVersion : null;
  }

  private notesAsked = false;

  /** Release notes of the version installed, from the GitHub API (public, no account). */
  private async readInstalledNotes(e: UpdatesState): Promise<void> {
    if (this.notesAsked || !e.installedVersion || !e.olderVersions?.length || e.installedRollback != null || e.installedNotes != null) return;
    const sample = e.olderVersions[0];
    const m = /github\.com\/([^/]+)\/([^/]+)\/releases(?:\/tag\/([^/?#]+))?/.exec(sample.url ?? '');
    if (!m) return;
    this.notesAsked = true;
    const prefix = m[3] && m[3].startsWith('v') && !sample.version.startsWith('v') ? 'v' : '';
    const cacheKey = `tb-notes-${e.installedVersion}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached != null) {
        this.installedNotes.set(cached);
        return;
      }
    } catch {
      /* private browsing */
    }
    try {
      const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/releases/tags/${prefix}${e.installedVersion}`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const body = ((await r.json()) as { body?: string }).body ?? '';
      this.installedNotes.set(body);
      try {
        sessionStorage.setItem(cacheKey, body);
      } catch {
        /* private browsing */
      }
    } catch {
      /* offline, or GitHub out of reach: the notes of the versions listed still count */
    }
  }

  async ngOnInit(): Promise<void> {
    await this.refresh(false);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async refresh(quiet: boolean): Promise<void> {
    try {
      const e = await firstValueFrom(this.api.state(quiet));
      this.state.set(e);
      this.restart.set(false);
      void this.readInstalledNotes(e);
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
      void this.readInstalledNotes(e);
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

  /**
   * Notes as HTML, already cleaned by DOMPurify (markdownToHtml): trusted as they are, so the
   * alignment of table cells and the boxes of task lists stay. One object per text, so the page
   * does not rewrite them at each check.
   */
  private readonly sanitizer = inject(DomSanitizer);
  private readonly notesHtml = new Map<string, SafeHtml>();
  protected notes = (text: string | null | undefined): SafeHtml => {
    const k = text ?? '';
    let h = this.notesHtml.get(k);
    if (!h) {
      h = this.sanitizer.bypassSecurityTrustHtml(markdownToHtml(text));
      this.notesHtml.set(k, h);
    }
    return h;
  };
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

/** Newest first when sorted with (b, a): the order of the server (Version.kt). */
function compareTags(a: string, b: string): number {
  const x = Version.read(a);
  const y = Version.read(b);
  return x && y ? x.compare(y) : a.localeCompare(b);
}

function key(v: AvailableVersion): string {
  return v.prerelease ? v.channel || 'test' : 'stable';
}

/**
 * Colour of a version, warmer as it nears a stable one: nightly (violet), alpha (blue), beta
 * (orange), rc (a strong orange: nearly stable), stable (green).
 */
function color(c: string): string {
  return c === 'stable' ? 'stable' : c === 'nightly' ? 'nightly' : c === 'alpha' ? 'alpha' : c === 'rc' ? 'rc' : 'test';
}

function label(c: string): string {
  return c === 'rc' ? 'RC' : c === 'nightly' ? 'Nightly' : c.charAt(0).toUpperCase() + c.slice(1);
}
