import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

import { matches } from '../core/text';

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
  selector: 'tb-choice-multiple',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-choice-multiple">
      @if (options().length > 6) {
        <span class="tb-search tb-choice-search">
          <i class="pi pi-search"></i>
          <input class="tb-input" type="search" [placeholder]="placeholder()" [value]="search()" (input)="search.set($any($event.target).value)" [attr.aria-label]="placeholder()" />
        </span>
      }
      <ul class="tb-choice-list">
        @for (o of visible(); track o.id) {
          <li>
            <label class="tb-choice">
              <input type="checkbox" [checked]="value().has(o.id)" (change)="toggle(o.id, $any($event.target).checked)" />
              <span>{{ o.label }}@if (o.detail) { <span class="tb-muted"> {{ o.detail }}</span> }</span>
            </label>
          </li>
        } @empty {
          <li class="tb-muted tb-choice-empty">{{ empty() }}</li>
        }
      </ul>
      <span class="tb-muted tb-choice-account">{{ value().size ? value().size + ' choisi(s)' : empty() }}</span>
    </div>
  `,
})
export class TbMultipleChoice {
  readonly options = input.required<Option[]>();
  readonly value = model<Set<number>>(new Set());
  readonly placeholder = input('Rechercher…');
  readonly empty = input('Aucun');
  protected readonly search = signal('');
  protected readonly visible = computed(() => this.options().filter((o) => !this.search().trim() || matches(o.label, this.search())));

  protected toggle(id: number, checked: boolean): void {
    const s = new Set(this.value());
    if (checked) s.add(id);
    else s.delete(id);
    this.value.set(s);
  }
}
