import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { Noeud } from '../models/models';
import { LIBELLES } from '../services/arbre.store';

interface Branche {
  noeud: Noeud;
  enfants: Branche[];
}

/**
 * Bâtiments → étages → salles with checkboxes (p:tree selectionMode="checkbox"), for the accesses
 * of a user and the elements of a group. No boxes: they follow their salle.
 *
 * Ticking an element ticks what it contains (propagateSelectionDown). On save, [retenus] keeps an
 * element with everything it contains (and what will be added later) only when it is ticked with
 * all its content; otherwise only its ticked content: unticking one salle of an allowed étage
 * limits the access to the others.
 */
@Component({
  selector: 'tb-arbre-acces',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-arbre-acces" role="tree">
      <ng-template #rendu let-branches>
        <ul role="group">
          @for (b of branches; track b.noeud.id) {
            <li role="treeitem" [attr.aria-expanded]="b.enfants.length ? ouvert(b.noeud.id) : null">
              <div class="tb-arbre-ligne">
                @if (b.enfants.length) {
                  <button type="button" [class.tb-ouvert]="ouvert(b.noeud.id)" (click)="basculerOuvert(b.noeud.id)"
                          [attr.aria-label]="(ouvert(b.noeud.id) ? 'Replier ' : 'Déplier ') + b.noeud.name">
                    <i class="pi pi-chevron-right"></i>
                  </button>
                } @else {
                  <span class="tb-arbre-vide"></span>
                }
                <label>
                  <input type="checkbox" class="tb-check" [checked]="coche(b.noeud.id)" [indeterminate]="partiel(b)" (change)="basculer(b, $any($event.target).checked)" />
                  <span class="tb-acces-noeud">{{ b.noeud.name }}<span class="tb-muted">{{ libelle(b.noeud) }}</span></span>
                </label>
              </div>
              @if (b.enfants.length && ouvert(b.noeud.id)) {
                <ng-container *ngTemplateOutlet="rendu; context: { $implicit: b.enfants }" />
              }
            </li>
          }
        </ul>
      </ng-template>
      <ng-container *ngTemplateOutlet="rendu; context: { $implicit: branches() }" />
      @if (!branches().length) {
        <p class="tb-muted" style="margin: 12px">Aucun bâtiment pour le moment.</p>
      }
    </div>
  `,
  imports: [NgTemplateOutlet],
})
export class TbArbreAcces {
  /** Every element of the tree (from ArbreStore): boxes are left out here. */
  readonly noeuds = input.required<Noeud[]>();
  /** Ids of the ticked elements. */
  readonly coches = model<Set<number>>(new Set());

  private readonly fermes = signal<Set<number>>(new Set());

  protected readonly branches = computed(() => {
    const noeuds = this.noeuds().filter((n) => n.kind !== 'BOITIER');
    const ids = new Set(noeuds.map((n) => n.id));
    const parParent = new Map<number, Noeud[]>();
    for (const n of noeuds) {
      const p = n.parentId != null && ids.has(n.parentId) ? n.parentId : -1;
      parParent.set(p, [...(parParent.get(p) ?? []), n]);
    }
    const construire = (p: number, profondeur: number): Branche[] =>
      profondeur > 5 ? [] : (parParent.get(p) ?? []).map((noeud) => ({ noeud, enfants: construire(noeud.id, profondeur + 1) }));
    return construire(-1, 0);
  });

  protected libelle(n: Noeud): string {
    return LIBELLES[n.kind];
  }

  protected ouvert(id: number): boolean {
    return !this.fermes().has(id);
  }

  protected basculerOuvert(id: number): void {
    this.fermes.update((s) => {
      const r = new Set(s);
      if (r.has(id)) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  protected coche(id: number): boolean {
    return this.coches().has(id);
  }

  /** Some of its content is ticked, not all. */
  protected partiel(b: Branche): boolean {
    if (this.coche(b.noeud.id) || !b.enfants.length) return false;
    const tous = descendants(b);
    return tous.some((d) => this.coche(d.noeud.id));
  }

  /** Ticking ticks the content; unticking unticks the content and the ancestors. */
  protected basculer(b: Branche, coche: boolean): void {
    const s = new Set(this.coches());
    for (const d of [b, ...descendants(b)]) {
      if (coche) s.add(d.noeud.id);
      else s.delete(d.noeud.id);
    }
    if (!coche) {
      let p = b.noeud.parentId;
      const parId = new Map(this.noeuds().map((n) => [n.id, n]));
      while (p != null) {
        s.delete(p);
        p = parId.get(p)?.parentId ?? null;
      }
    }
    this.coches.set(s);
  }

  /** What to record: an element counts with all it contains only when fully ticked. */
  retenus(): number[] {
    const coches = this.coches();
    const complet = (b: Branche): boolean => coches.has(b.noeud.id) && b.enfants.every(complet);
    const retenir = (bs: Branche[]): number[] => bs.flatMap((b) => (complet(b) ? [b.noeud.id] : retenir(b.enfants)));
    return retenir(this.branches());
  }

  /** The elements granted, and everything they contain, ticked. */
  static cocher(noeuds: Noeud[], accordes: Iterable<number>): Set<number> {
    const s = new Set<number>();
    const parParent = new Map<number, Noeud[]>();
    for (const n of noeuds) if (n.parentId != null) parParent.set(n.parentId, [...(parParent.get(n.parentId) ?? []), n]);
    const ajouter = (id: number, profondeur: number) => {
      if (profondeur > 6 || s.has(id)) return;
      s.add(id);
      for (const e of parParent.get(id) ?? []) if (e.kind !== 'BOITIER') ajouter(e.id, profondeur + 1);
    };
    for (const id of accordes) ajouter(id, 0);
    return s;
  }
}

function descendants(b: Branche): Branche[] {
  return b.enfants.flatMap((e) => [e, ...descendants(e)]);
}
