import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

import { correspond } from '../core/texte';

export interface Option {
  id: number;
  label: string;
  detail?: string;
}

/**
 * Several choices among a list, with a search field (p:selectCheckboxMenu): users of a group,
 * users and groups given an access.
 */
@Component({
  selector: 'tb-choix-multiple',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-choix-multiple">
      @if (options().length > 6) {
        <span class="tb-search tb-choix-recherche">
          <i class="pi pi-search"></i>
          <input class="tb-input" type="search" [placeholder]="placeholder()" [value]="recherche()" (input)="recherche.set($any($event.target).value)" [attr.aria-label]="placeholder()" />
        </span>
      }
      <ul class="tb-choix-liste">
        @for (o of visibles(); track o.id) {
          <li>
            <label class="tb-choix">
              <input type="checkbox" [checked]="valeur().has(o.id)" (change)="basculer(o.id, $any($event.target).checked)" />
              <span>{{ o.label }}@if (o.detail) { <span class="tb-muted"> {{ o.detail }}</span> }</span>
            </label>
          </li>
        } @empty {
          <li class="tb-muted tb-choix-vide">{{ vide() }}</li>
        }
      </ul>
      <span class="tb-muted tb-choix-compte">{{ valeur().size ? valeur().size + ' choisi(s)' : vide() }}</span>
    </div>
  `,
})
export class TbChoixMultiple {
  readonly options = input.required<Option[]>();
  readonly valeur = model<Set<number>>(new Set());
  readonly placeholder = input('Rechercher…');
  readonly vide = input('Aucun');
  protected readonly recherche = signal('');
  protected readonly visibles = computed(() => this.options().filter((o) => !this.recherche().trim() || correspond(o.label, this.recherche())));

  protected basculer(id: number, coche: boolean): void {
    const s = new Set(this.valeur());
    if (coche) s.add(id);
    else s.delete(id);
    this.valeur.set(s);
  }
}
