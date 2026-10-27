import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../core/api.config';
import { ToastService } from '../core/messages';
import { AccessStore, UserRow } from '../services/access.store';
import { GroupService } from '../services/group.service';
import { TbMultipleChoice } from './multiple-choice';
import { TbSheet } from './sheet';

/**
 * The groups of one user (ADMIN), ticked in the list of all the groups. Opened from the
 * Utilisateurs page and the « Utilisateurs et groupes » tab, by tapping the groups of a user (or
 * the « + » when they have none). Only the groups whose membership changed are saved.
 *
 *   <tb-user-groups-sheet (saved)="reload()" />   …   sheet.open(row)
 */
@Component({
  selector: 'tb-user-groups-sheet',
  imports: [TbSheet, TbMultipleChoice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" title="Groupes" [width]="460">
      @if (row(); as l) {
        <p class="tb-muted tb-access-intro">
          Les groupes de <strong>{{ l.user.username }}</strong> : il voit en plus ce que chacun d'eux donne{{ l.unlimited ? ' (il voit déjà tout ThermoBox)' : '' }}.
        </p>
        @if (options().length) {
          <tb-choice-multiple [options]="options()" [(value)]="checked" placeholder="Rechercher un groupe…" empty="Aucun groupe" />
        } @else {
          <p class="tb-empty tb-empty-sm">Aucun groupe pour l'instant.</p>
        }
        <div class="tb-actions">
          @if (canCreate()) {
            <button type="button" class="tb-btn tb-flat tb-actions-start" (click)="shown.set(false); create.emit(l)"><i class="pi pi-plus"></i>Nouveau groupe</button>
          }
          <button type="button" class="tb-btn tb-flat" (click)="shown.set(false)">Annuler</button>
          <button type="button" class="tb-btn" [disabled]="saving()" (click)="save()"><i class="pi pi-check"></i>Enregistrer</button>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbUserGroupsSheet {
  private readonly access = inject(AccessStore);
  private readonly groupsApi = inject(GroupService);
  private readonly toasts = inject(ToastService);

  /** Offer « Nouveau groupe » (the page then opens its group form with this user in it). */
  readonly canCreate = input(false);
  readonly create = output<UserRow>();
  /** The groups were saved (the list is read again). */
  readonly saved = output<void>();

  protected readonly shown = signal(false);
  protected readonly row = signal<UserRow | null>(null);
  protected readonly checked = signal<Set<number>>(new Set());
  private before = new Set<number>();
  protected readonly saving = signal(false);

  protected readonly options = computed(() =>
    this.access.groups().map((g) => ({ id: g.id, label: g.name, detail: `${g.members.length} membre(s)` })),
  );

  open(l: UserRow): void {
    const mine = new Set(this.access.groups().filter((g) => g.members.some((m) => m.id === l.user.id)).map((g) => g.id));
    this.before = mine;
    this.checked.set(new Set(mine));
    this.row.set(l);
    this.shown.set(true);
  }

  protected async save(): Promise<void> {
    const l = this.row();
    if (!l) return;
    const id = l.user.id!;
    const now = this.checked();
    const changed = this.access.groups().filter((g) => now.has(g.id) !== this.before.has(g.id));
    if (!changed.length) {
      this.shown.set(false);
      return;
    }
    this.saving.set(true);
    try {
      for (const g of changed) {
        const req = GroupService.query(g);
        req.members = now.has(g.id) ? [...new Set([...req.members, id])] : req.members.filter((m) => m !== id);
        await firstValueFrom(this.groupsApi.edit(g.id, req));
      }
      const added = changed.filter((g) => now.has(g.id)).length;
      const removed = changed.length - added;
      this.toasts.info(
        `Groupes de « ${l.user.username} » enregistrés`,
        [added ? `ajouté à ${added} groupe(s)` : null, removed ? `retiré de ${removed} groupe(s)` : null].filter(Boolean).join(', '),
      );
      this.shown.set(false);
      this.saved.emit();
    } catch (e) {
      this.toasts.error('Enregistrement impossible', errorMessage(e));
      this.saved.emit();
    } finally {
      this.saving.set(false);
    }
  }
}
