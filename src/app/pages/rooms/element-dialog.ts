import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { ToastService } from '../../core/messages';
import { Node, RoomKind } from '../../models/models';
import { TreeStore, LABELS, KIND_ORDER, PARENTS } from '../../services/tree.store';
import { HierarchyService } from '../../services/hierarchy.service';
import { TbSheet } from '../../ui/sheet';

/** What the dialog opens on: a new element (kind, parent) or an existing one. */
export interface ElementEdit {
  element?: Node;
  kind: RoomKind;
  parentId: number | null;
}

/**
 * Add / edit an element (ADMIN): kind (fixed once created: it decides where it fits), name, and
 * where it goes (« Dans », with only the possible parents). Used by the Rooms and Gestion pages.
 */
@Component({
  selector: 'tb-element-dialog',
  imports: [TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [open]="editing() != null" (openChange)="!$event && editing.set(null)" [title]="editing()?.element ? 'Modifier' : 'Ajouter'">
      @if (editing(); as e) {
        <form (submit)="save($event)" novalidate>
          <div class="tb-field">
            <label class="tb-label" for="tb-el-kind">Type</label>
            <select id="tb-el-kind" class="tb-select" [disabled]="!!e.element" (change)="changeKind($any($event.target).value)">
              @for (k of kinds(); track k) {
                <option [value]="k" [selected]="kind() === k">{{ labels[k] }}</option>
              }
            </select>
          </div>
          <div class="tb-field">
            <label class="tb-label" for="tb-el-name">Nom</label>
            <input id="tb-el-name" class="tb-input" [value]="name()" (input)="name.set($any($event.target).value)" [class.tb-invalid]="sent() && !name().trim()" autocomplete="off" />
            @if (sent() && !name().trim()) {
              <span class="tb-field-error">Le nom est obligatoire</span>
            }
          </div>
          @if (parentsLabel()) {
            <div class="tb-field">
              <label class="tb-label" for="tb-el-parent">Dans ({{ parentsLabel() }})</label>
              <select id="tb-el-parent" class="tb-select" (change)="parentId.set($any($event.target).value === '' ? null : +$any($event.target).value)">
                <option value="" [selected]="parentId() == null">— Non rattaché —</option>
                @for (p of parents(); track p.id) {
                  <option [value]="p.id" [selected]="parentId() === p.id">{{ store.label(p) }}</option>
                }
              </select>
            </div>
          }
          <div class="tb-actions">
            <button type="button" class="tb-btn tb-flat" (click)="editing.set(null)">Annuler</button>
            <button type="submit" class="tb-btn" [class.tb-busy]="inProgress()" [disabled]="inProgress()"><i class="pi pi-check"></i>Enregistrer</button>
          </div>
        </form>
      }
    </tb-sheet>
  `,
})
export class ElementDialog {
  protected readonly store = inject(TreeStore);
  private readonly api = inject(HierarchyService);
  private readonly toasts = inject(ToastService);

  readonly editing = model<ElementEdit | null>(null);
  /** Boxes can be created by hand only where they are shown (MANAGER, ADMIN). */
  readonly hasDevices = input(true);
  readonly saved = output<Node>();

  protected readonly labels = LABELS;
  protected readonly kind = signal<RoomKind>('BUILDING');
  protected readonly name = signal('');
  protected readonly parentId = signal<number | null>(null);
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);

  protected readonly kinds = computed(() => KIND_ORDER.filter((k) => k !== 'DEVICE' || this.hasDevices()));
  protected readonly parents = computed(() => this.store.possibleParents(this.kind(), this.editing()?.element?.id));
  /** « étage ou bâtiment » */
  protected readonly parentsLabel = computed(() => PARENTS[this.kind()].map((k) => LABELS[k].toLowerCase()).join(' ou '));

  /** Called by the pages when they open the dialog. */
  open(e: ElementEdit): void {
    this.kind.set(e.element?.kind ?? e.kind);
    this.name.set(e.element?.name ?? '');
    this.parentId.set(e.element ? e.element.parentId : e.parentId);
    this.sent.set(false);
    this.editing.set(e);
  }

  protected changeKind(k: RoomKind): void {
    this.kind.set(k);
    // The possible parents change with the kind
    if (!this.parents().some((p) => p.id === this.parentId())) this.parentId.set(null);
  }

  protected async save(ev: Event): Promise<void> {
    ev.preventDefault();
    this.sent.set(true);
    const name = this.name().trim();
    const e = this.editing();
    if (!name || !e) return;
    this.inProgress.set(true);
    try {
      const n = e.element
        ? await firstValueFrom(this.api.edit(e.element.id, name, this.parentId()))
        : await firstValueFrom(this.api.create({ kind: this.kind(), name: name, parentId: this.parentId() }));
      this.toasts.info(`${LABELS[n.kind]} « ${name} » enregistré(e)`);
      this.editing.set(null);
      this.saved.emit(n);
    } catch (err) {
      this.toasts.error(e.element ? 'Enregistrement impossible' : 'Rattachement impossible', errorMessage(err));
    } finally {
      this.inProgress.set(false);
    }
  }
}
