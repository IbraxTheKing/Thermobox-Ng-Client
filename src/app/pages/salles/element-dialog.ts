import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { ToastService } from '../../core/messages';
import { Noeud, SalleKind } from '../../models/models';
import { ArbreStore, LIBELLES, ORDRE_KINDS, PARENTS } from '../../services/arbre.store';
import { HierarchieService } from '../../services/hierarchie.service';
import { TbSheet } from '../../ui/sheet';

/** What the dialog opens on: a new element (kind, parent) or an existing one. */
export interface EditionElement {
  element?: Noeud;
  kind: SalleKind;
  parentId: number | null;
}

/**
 * Add / edit an element (ADMIN): kind (fixed once created: it decides where it fits), name, and
 * where it goes (« Dans », with only the possible parents). Used by the Salles and Gestion pages.
 */
@Component({
  selector: 'tb-element-dialog',
  imports: [TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [ouvert]="edition() != null" (ouvertChange)="!$event && edition.set(null)" [titre]="edition()?.element ? 'Modifier' : 'Ajouter'">
      @if (edition(); as e) {
        <form (submit)="enregistrer($event)" novalidate>
          <div class="tb-field">
            <label class="tb-label" for="tb-el-kind">Type</label>
            <select id="tb-el-kind" class="tb-select" [disabled]="!!e.element" (change)="changerKind($any($event.target).value)">
              @for (k of kinds(); track k) {
                <option [value]="k" [selected]="kind() === k">{{ libelles[k] }}</option>
              }
            </select>
          </div>
          <div class="tb-field">
            <label class="tb-label" for="tb-el-nom">Nom</label>
            <input id="tb-el-nom" class="tb-input" [value]="nom()" (input)="nom.set($any($event.target).value)" [class.tb-invalid]="envoye() && !nom().trim()" autocomplete="off" />
            @if (envoye() && !nom().trim()) {
              <span class="tb-field-error">Le nom est obligatoire</span>
            }
          </div>
          @if (parentsLabel()) {
            <div class="tb-field">
              <label class="tb-label" for="tb-el-parent">Dans ({{ parentsLabel() }})</label>
              <select id="tb-el-parent" class="tb-select" (change)="parentId.set($any($event.target).value === '' ? null : +$any($event.target).value)">
                <option value="" [selected]="parentId() == null">— Non rattaché —</option>
                @for (p of parents(); track p.id) {
                  <option [value]="p.id" [selected]="parentId() === p.id">{{ store.libelle(p) }}</option>
                }
              </select>
            </div>
          }
          <div class="tb-actions">
            <button type="button" class="tb-btn tb-flat" (click)="edition.set(null)">Annuler</button>
            <button type="submit" class="tb-btn" [class.tb-busy]="enCours()" [disabled]="enCours()"><i class="pi pi-check"></i>Enregistrer</button>
          </div>
        </form>
      }
    </tb-sheet>
  `,
})
export class ElementDialog {
  protected readonly store = inject(ArbreStore);
  private readonly api = inject(HierarchieService);
  private readonly toasts = inject(ToastService);

  readonly edition = model<EditionElement | null>(null);
  /** Boxes can be created by hand only where they are shown (GESTIONNAIRE, ADMIN). */
  readonly avecBoitiers = input(true);
  readonly enregistre = output<Noeud>();

  protected readonly libelles = LIBELLES;
  protected readonly kind = signal<SalleKind>('BATIMENT');
  protected readonly nom = signal('');
  protected readonly parentId = signal<number | null>(null);
  protected readonly envoye = signal(false);
  protected readonly enCours = signal(false);

  protected readonly kinds = computed(() => ORDRE_KINDS.filter((k) => k !== 'BOITIER' || this.avecBoitiers()));
  protected readonly parents = computed(() => this.store.parentsPossibles(this.kind(), this.edition()?.element?.id));
  /** « étage ou bâtiment » */
  protected readonly parentsLabel = computed(() => PARENTS[this.kind()].map((k) => LIBELLES[k].toLowerCase()).join(' ou '));

  /** Called by the pages when they open the dialog. */
  ouvrir(e: EditionElement): void {
    this.kind.set(e.element?.kind ?? e.kind);
    this.nom.set(e.element?.name ?? '');
    this.parentId.set(e.element ? e.element.parentId : e.parentId);
    this.envoye.set(false);
    this.edition.set(e);
  }

  protected changerKind(k: SalleKind): void {
    this.kind.set(k);
    // The possible parents change with the kind
    if (!this.parents().some((p) => p.id === this.parentId())) this.parentId.set(null);
  }

  protected async enregistrer(ev: Event): Promise<void> {
    ev.preventDefault();
    this.envoye.set(true);
    const nom = this.nom().trim();
    const e = this.edition();
    if (!nom || !e) return;
    this.enCours.set(true);
    try {
      const n = e.element
        ? await firstValueFrom(this.api.modifier(e.element.id, nom, this.parentId()))
        : await firstValueFrom(this.api.creer({ kind: this.kind(), name: nom, parentId: this.parentId() }));
      this.toasts.info(`${LIBELLES[n.kind]} « ${nom} » enregistré(e)`);
      this.edition.set(null);
      this.enregistre.emit(n);
    } catch (err) {
      this.toasts.error(e.element ? 'Enregistrement impossible' : 'Rattachement impossible', messageErreur(err));
    } finally {
      this.enCours.set(false);
    }
  }
}
