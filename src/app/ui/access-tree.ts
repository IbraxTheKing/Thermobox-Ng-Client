import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { Node } from '../models/models';
import { LABELS } from '../services/tree.store';

interface Branch {
  node: Node;
  children: Branch[];
}

/**
 * Buildings → floors → rooms with checkboxes (p:tree selectionMode="checkbox"), for the accesses
 * of a user and the elements of a group. No boxes: they follow their room.
 *
 * Ticking an element ticks what it contains (propagateSelectionDown). On save, [retenus] keeps an
 * element with everything it contains (and what will be added later) only when it is ticked with
 * all its content; otherwise only its ticked content: unticking one room of an allowed floor
 * limits the access to the others.
 */
@Component({
  selector: 'tb-tree-access',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-tree-access" role="tree">
      <ng-template #rendu let-branches>
        <ul role="group">
          @for (b of branches; track b.node.id) {
            <li role="treeitem" [attr.aria-expanded]="b.children.length ? open(b.node.id) : null">
              <div class="tb-tree-row">
                @if (b.children.length) {
                  <button type="button" [class.tb-open]="open(b.node.id)" (click)="toggleOpen(b.node.id)"
                          [attr.aria-label]="(open(b.node.id) ? 'Replier ' : 'Déplier ') + b.node.name">
                    <i class="pi pi-chevron-right"></i>
                  </button>
                } @else {
                  <span class="tb-tree-empty"></span>
                }
                <label>
                  <input type="checkbox" class="tb-check" [checked]="isTicked(b.node.id)" [indeterminate]="partial(b)" (change)="toggle(b, $any($event.target).checked)" />
                  <span class="tb-access-node">{{ b.node.name }}<span class="tb-muted">{{ label(b.node) }}</span></span>
                </label>
              </div>
              @if (b.children.length && open(b.node.id)) {
                <ng-container *ngTemplateOutlet="rendu; context: { $implicit: b.children }" />
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
export class TbAccessTree {
  /** Every element of the tree (from TreeStore): boxes are left out here. */
  readonly nodes = input.required<Node[]>();
  /** Ids of the ticked elements. */
  readonly checked = model<Set<number>>(new Set());

  private readonly closed = signal<Set<number>>(new Set());

  protected readonly branches = computed(() => {
    const nodes = this.nodes().filter((n) => n.kind !== 'DEVICE');
    const ids = new Set(nodes.map((n) => n.id));
    const byParent = new Map<number, Node[]>();
    for (const n of nodes) {
      const p = n.parentId != null && ids.has(n.parentId) ? n.parentId : -1;
      byParent.set(p, [...(byParent.get(p) ?? []), n]);
    }
    const build = (p: number, depth: number): Branch[] =>
      depth > 5 ? [] : (byParent.get(p) ?? []).map((node) => ({ node, children: build(node.id, depth + 1) }));
    return build(-1, 0);
  });

  protected label(n: Node): string {
    return LABELS[n.kind];
  }

  protected open(id: number): boolean {
    return !this.closed().has(id);
  }

  protected toggleOpen(id: number): void {
    this.closed.update((s) => {
      const r = new Set(s);
      if (r.has(id)) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  protected isTicked(id: number): boolean {
    return this.checked().has(id);
  }

  /** Some of its content is ticked, not all. */
  protected partial(b: Branch): boolean {
    if (this.isTicked(b.node.id) || !b.children.length) return false;
    const all = descendants(b);
    return all.some((d) => this.isTicked(d.node.id));
  }

  /** Ticking ticks the content; unticking unticks the content and the ancestors. */
  protected toggle(b: Branch, checked: boolean): void {
    const s = new Set(this.checked());
    for (const d of [b, ...descendants(b)]) {
      if (checked) s.add(d.node.id);
      else s.delete(d.node.id);
    }
    if (!checked) {
      let p = b.node.parentId;
      const byId = new Map(this.nodes().map((n) => [n.id, n]));
      while (p != null) {
        s.delete(p);
        p = byId.get(p)?.parentId ?? null;
      }
    }
    this.checked.set(s);
  }

  /** What to record: an element counts with all it contains only when fully ticked. */
  kept(): number[] {
    const checked = this.checked();
    const full = (b: Branch): boolean => checked.has(b.node.id) && b.children.every(full);
    const keep = (bs: Branch[]): number[] => bs.flatMap((b) => (full(b) ? [b.node.id] : keep(b.children)));
    return keep(this.branches());
  }

  /** The elements granted, and everything they contain, ticked. */
  static check(nodes: Node[], granted: Iterable<number>): Set<number> {
    const s = new Set<number>();
    const byParent = new Map<number, Node[]>();
    for (const n of nodes) if (n.parentId != null) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
    const add = (id: number, depth: number) => {
      if (depth > 6 || s.has(id)) return;
      s.add(id);
      for (const e of byParent.get(id) ?? []) if (e.kind !== 'DEVICE') add(e.id, depth + 1);
    };
    for (const id of granted) add(id, 0);
    return s;
  }
}

function descendants(b: Branch): Branch[] {
  return b.children.flatMap((e) => [e, ...descendants(e)]);
}
