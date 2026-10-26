import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../core/api.config';
import { onAccountChange } from '../core/auth';
import { Tree, Node, RoomKind } from '../models/models';
import { normalize } from '../core/text';
import { HierarchyService } from './hierarchy.service';

/** Kinds that may contain a kind (RoomKind.parentKinds of the server). */
export const PARENTS: Record<RoomKind, RoomKind[]> = {
  BUILDING: [],
  FLOOR: ['BUILDING'],
  ROOM: ['FLOOR', 'BUILDING'],
  DEVICE: ['ROOM'],
};

/** Kinds a kind may contain. */
export const CHILDREN: Record<RoomKind, RoomKind[]> = {
  BUILDING: ['FLOOR', 'ROOM'],
  FLOOR: ['ROOM'],
  ROOM: ['DEVICE'],
  DEVICE: [],
};

export const LABELS: Record<RoomKind, string> = {
  BUILDING: 'Bâtiment',
  FLOOR: 'Étage',
  ROOM: 'Salle',
  DEVICE: 'Boîtier',
};

export const WITH_ARTICLE: Record<RoomKind, string> = {
  BUILDING: 'un bâtiment',
  FLOOR: 'un étage',
  ROOM: 'une salle',
  DEVICE: 'un boîtier',
};

export const ICONS: Record<RoomKind, string> = {
  BUILDING: 'pi-building',
  FLOOR: 'pi-server',
  ROOM: 'pi-home',
  DEVICE: 'pi-wifi',
};

export const KIND_ORDER: RoomKind[] = ['BUILDING', 'FLOOR', 'ROOM', 'DEVICE'];

/**
 * The building → floor → room → device tree as the logged-in user sees it
 * (GET /api/v2/hierarchy/tree), shared by the pages: dashboard, rooms, gestion, mesures, and the
 * lists of possible parents. Reloaded by each page when it opens, and by the 30-second polls.
 */
@Injectable({ providedIn: 'root' })
export class TreeStore {
  private readonly api = inject(HierarchyService);

  readonly tree = signal<Tree | null>(null);

  constructor() {
    // Another account (or none): its tree is not this one
    onAccountChange(() => {
      this.tree.set(null);
      this.error.set(null);
    });
  }

  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  readonly nodes = computed(() => this.tree()?.nodes ?? []);
  readonly all = computed(() => this.tree()?.all ?? false);

  readonly byId = computed(() => new Map(this.nodes().map((n) => [n.id, n])));

  /** Children of each element (key -1: the top level), in the server's order (kind, name). */
  readonly children = computed(() => {
    const byId = this.byId();
    const m = new Map<number, Node[]>();
    for (const n of this.nodes()) {
      // A parent the user can't see (shouldn't happen): shown at the top level
      const p = n.parentId != null && byId.has(n.parentId) ? n.parentId : -1;
      const l = m.get(p) ?? [];
      l.push(n);
      m.set(p, l);
    }
    return m;
  });

  readonly roots = computed(() => this.children().get(-1) ?? []);
  readonly buildings = computed(() => this.nodes().filter((n) => n.kind === 'BUILDING'));

  /** Rooms (not floors, buildings or boxes) whose data the user may see: the dashboard cards. */
  readonly rooms = computed(() => this.nodes().filter((n) => n.kind === 'ROOM' && n.accessible));

  /** Boxes that measure but belong to no room (ADMIN, MANAGER). */
  readonly unattachedDevices = computed(() => this.nodes().filter((n) => n.kind === 'DEVICE' && !n.attached).length);

  async load(quiet = false): Promise<void> {
    if (!quiet) this.loading.set(true);
    try {
      const a = await firstValueFrom(this.api.tree(quiet));
      this.tree.set(a);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e, "Impossible de charger les bâtiments et salles"));
      if (!quiet) throw e;
    } finally {
      this.loading.set(false);
    }
  }

  /** Changes one element in place (favourite toggled, renamed…) until the next reload. */
  replace(n: Node): void {
    const a = this.tree();
    if (!a) return;
    this.tree.set({ ...a, nodes: a.nodes.map((x) => (x.id === n.id ? n : x)) });
  }

  /** Ancestors of [id], from the building down to its direct parent. */
  path(id: number): Node[] {
    const byId = this.byId();
    const r: Node[] = [];
    let current = byId.get(id)?.parentId;
    while (current != null && r.length < 6) {
      const p = byId.get(current);
      if (!p) break;
      r.unshift(p);
      current = p.parentId;
    }
    return r;
  }

  /** « Bâtiment A › Étage 1 » */
  pathText(id: number): string {
    return this.path(id)
      .map((n) => n.name ?? '')
      .join(' › ');
  }

  /** The building [id] is in, if any. */
  buildingOf(id: number): Node | null {
    return this.path(id).find((n) => n.kind === 'BUILDING') ?? null;
  }

  /** Every element under [id], at any depth. */
  descendants(id: number): Node[] {
    const r: Node[] = [];
    const browse = (p: number, depth: number) => {
      if (depth > 5) return;
      for (const e of this.children().get(p) ?? []) {
        r.push(e);
        browse(e.id, depth + 1);
      }
    };
    browse(id, 0);
    return r;
  }

  /** Where an element of [kind] can go (sorted by kind then name). */
  possibleParents(kind: RoomKind, except?: number): Node[] {
    const excluded = new Set(except != null ? [except, ...this.descendants(except).map((n) => n.id)] : []);
    return this.nodes()
      .filter((n) => PARENTS[kind].includes(n.kind) && !excluded.has(n.id))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || normalize(a.name).localeCompare(normalize(b.name), 'fr'));
  }

  /** « Étage 1 (Étage, Bâtiment A) » for a list of parents. */
  label(n: Node): string {
    const path = this.pathText(n.id);
    return path ? `${n.name} (${LABELS[n.kind]}, ${path})` : `${n.name} (${LABELS[n.kind]})`;
  }

  clear(): void {
    this.tree.set(null);
  }
}
