import { ChangeDetectionStrategy, Component, inject, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../core/api.config';
import { ToastService } from '../core/messages';
import { UserRow } from '../services/access.store';
import { TreeStore } from '../services/tree.store';
import { UserService } from '../services/user.service';
import { TbAccessTree } from './access-tree';
import { TbSheet } from './sheet';

/**
 * The accesses of one user (ADMIN): everything, or only the ticked buildings / floors / rooms.
 * Opened from the Utilisateurs page and the « Utilisateurs et groupes » tab, by tapping what a
 * user may see.
 *
 *   <tb-user-access-sheet (saved)="reload()" />   …   sheet.open(row)
 */
@Component({
  selector: 'tb-user-access-sheet',
  imports: [TbSheet, TbAccessTree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" title="Accès" [width]="520">
      @if (row(); as l) {
        <p class="tb-muted tb-access-intro">
          Ce que <strong>{{ l.user.username }}</strong> ({{ roleName(l.user.type) }}) peut consulter{{ l.user.type === 'MANAGER' ? ' et piloter' : '' }}.
        </p>
        <div class="tb-access-mode" role="radiogroup">
          <label class="tb-choice"><input type="radio" name="tb-access-mode" [checked]="!restricted()" (change)="restricted.set(false)" />Tout ThermoBox</label>
          <label class="tb-choice"><input type="radio" name="tb-access-mode" [checked]="restricted()" (change)="restricted.set(true)" />Seulement les éléments cochés</label>
        </div>
        @if (restricted()) {
          <p class="tb-muted tb-access-rule">
            Cocher un bâtiment ou un étage donne accès à tout ce qu'il contient, y compris ce qui y sera ajouté plus tard. Décocher une salle
            limite l'accès aux autres.
          </p>
          <tb-tree-access [nodes]="tree.nodes()" [(checked)]="checked" />
        }
        @if (l.groups.length) {
          <p class="tb-muted tb-access-rule"><i class="pi pi-users"></i> En plus, par ses groupes : {{ l.groups.join(', ') }}.</p>
        }
        <div class="tb-actions">
          <button type="button" class="tb-btn tb-flat" (click)="shown.set(false)">Annuler</button>
          <button type="button" class="tb-btn" [disabled]="saving()" (click)="save()"><i class="pi pi-check"></i>Enregistrer</button>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbUserAccessSheet {
  protected readonly tree = inject(TreeStore);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly accessTree = viewChild(TbAccessTree);

  /** The accesses were saved (the list is read again). */
  readonly saved = output<void>();

  protected readonly shown = signal(false);
  protected readonly row = signal<UserRow | null>(null);
  /** false: sees everything; true: only what is ticked. */
  protected readonly restricted = signal(true);
  protected readonly checked = signal<Set<number>>(new Set());
  protected readonly saving = signal(false);

  protected roleName(r: string | null | undefined): string {
    return r ? (({ ADMIN: 'Administrateur', MANAGER: 'Gestionnaire', VIEWER: 'Lecteur' }) as Record<string, string>)[r] ?? r : '';
  }

  /** Reads the accesses of [l] as they are now, then shows them. An ADMIN sees everything: nothing to set. */
  async open(l: UserRow): Promise<void> {
    if (l.user.type === 'ADMIN') {
      this.toasts.info('Un administrateur voit tout ThermoBox');
      return;
    }
    if (!this.tree.tree()) await this.tree.load().catch(() => undefined);
    try {
      const a = await firstValueFrom(this.users.getAccess(l.user.id!));
      this.row.set(l);
      this.restricted.set(a.restricted);
      this.checked.set(TbAccessTree.check(this.tree.nodes(), a.elements.map((e) => e.id)));
      this.shown.set(true);
    } catch (e) {
      this.toasts.error('Impossible de lire les accès', errorMessage(e));
    }
  }

  /**
   * An element counts with everything it contains (and what will be added to it later) only if it
   * is ticked with all its content; otherwise only its ticked content counts.
   */
  protected async save(): Promise<void> {
    const l = this.row();
    if (!l) return;
    const elements = this.restricted() ? (this.accessTree()?.kept() ?? []) : [];
    this.saving.set(true);
    try {
      await firstValueFrom(this.users.setAccess(l.user.id!, this.restricted(), elements));
      this.toasts.info(`Accès de « ${l.user.username} » enregistrés`, this.restricted() ? `${elements.length} élément(s) et leur contenu` : 'Accès à tout');
      this.shown.set(false);
      this.saved.emit();
    } catch (e) {
      this.toasts.error('Enregistrement impossible', errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
