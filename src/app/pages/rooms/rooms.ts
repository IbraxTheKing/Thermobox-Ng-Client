import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { PreferencesService } from '../../core/preferences';
import { UnitService } from '../../core/unit';
import { Node, RoomKind } from '../../models/models';
import { TreeStore, CHILDREN, ICONS, LABELS } from '../../services/tree.store';
import { HierarchyService } from '../../services/hierarchy.service';
import { RoomService } from '../../services/room.service';
import { TbSheet } from '../../ui/sheet';
import { ElementDialog } from './element-dialog';

/**
 * Buildings and rooms (salles.xhtml): the whole structure. On wide screens a tree where an ADMIN
 * drags an element onto another to move it; on phones one level at a time, like a file browser,
 * with the actions of an element behind ⋮.
 */
@Component({
  selector: 'tb-rooms',
  imports: [RouterLink, NgTemplateOutlet, TbSheet, ElementDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rooms.html',
})
export class RoomsPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(TreeStore);
  protected readonly unit = inject(UnitService);
  private readonly prefs = inject(PreferencesService);
  /** « Maison »: the rooms of the house. */
  protected readonly home = computed(() => this.prefs.style() !== 'panel');
  private readonly api = inject(HierarchyService);
  private readonly rooms = inject(RoomService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly dialog = viewChild.required(ElementDialog);

  protected readonly labels = LABELS;
  protected readonly icons = ICONS;
  protected readonly possibleChildren = CHILDREN;

  /** Elements folded in the tree (rooms start folded: their boxes are below). */
  protected readonly folded = signal<Set<number>>(new Set());
  private initialized = false;

  /** Phones: the building / floor whose content is listed (null: the top level). */
  protected readonly folderId = signal<number | null>(null);
  /** Element whose actions are open in the sheet (phones). */
  protected readonly selection = signal<Node | null>(null);

  // Drag and drop (ADMIN, mouse)
  protected readonly slide = signal<number | null>(null);
  protected readonly hover = signal<number | 'racine' | null>(null);

  private timer?: ReturnType<typeof setInterval>;

  protected readonly folder = computed(() => {
    const id = this.folderId();
    return id != null ? (this.store.byId().get(id) ?? null) : null;
  });
  protected readonly content = computed(() => this.store.children().get(this.folderId() ?? -1) ?? []);
  protected readonly path = computed(() => {
    const d = this.folder();
    return d ? [...this.store.path(d.id), d] : [];
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load(this.store.tree() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les bâtiments et salles', errorMessage(e));
    }
    this.initFolded();
    this.timer = setInterval(() => void this.store.load(true).catch(() => undefined), 30_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private initFolded(): void {
    if (this.initialized || !this.store.tree()) return;
    this.initialized = true;
    this.folded.set(new Set(this.store.nodes().filter((n) => n.kind === 'ROOM').map((n) => n.id)));
  }

  protected icon(n: Node): string {
    return ICONS[n.kind];
  }

  protected label(n: Node): string {
    return LABELS[n.kind];
  }

  /** Kinds an element may contain (the first is offered by « Ajouter dedans »). */
  protected childrenOf(n: Node): RoomKind[] {
    return CHILDREN[n.kind];
  }

  protected children(id: number): Node[] {
    return this.store.children().get(id) ?? [];
  }

  protected isFolded(id: number): boolean {
    return this.folded().has(id);
  }

  protected toggle(id: number): void {
    this.folded.update((s) => {
      const r = new Set(s);
      if (r.has(id)) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  /** Buildings and floors open in the list; rooms and boxes open their page. */
  protected isFolder(n: Node): boolean {
    return n.kind === 'BUILDING' || n.kind === 'FLOOR';
  }

  protected open(id: number | null): void {
    this.folderId.set(id);
    scrollTo({ top: 0 });
  }

  protected goUp(): void {
    this.folderId.set(this.folder()?.parentId ?? null);
  }

  protected choose(n: Node): void {
    this.selection.set(n);
  }

  // ---------------------------------------------------------------- structure (ADMIN)

  protected create(kind: RoomKind, parent: Node | null): void {
    this.selection.set(null);
    this.dialog().open({ kind, parentId: parent?.id ?? null });
  }

  protected edit(n: Node): void {
    this.selection.set(null);
    this.dialog().open({ element: n, kind: n.kind, parentId: n.parentId });
  }

  protected async afterSave(): Promise<void> {
    await this.store.load().catch(() => undefined);
  }

  protected async detach(n: Node): Promise<void> {
    this.selection.set(null);
    try {
      await firstValueFrom(this.api.move(n.id, null));
      this.toasts.info(`« ${n.name} » n'est plus rattaché(e)`);
    } catch (e) {
      this.toasts.error('Détachement impossible', errorMessage(e));
    }
    await this.store.load().catch(() => undefined);
  }

  protected async remove(n: Node): Promise<void> {
    this.selection.set(null);
    const ok = await this.confirm.ask(`Supprimer « ${n.name} »`, "Son historique est supprimé ; ce qu'il contient est gardé mais n'est plus rattaché.", {
      confirm: 'Supprimer',
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.rooms.remove(n.id));
      this.toasts.info(`« ${n.name} » supprimé(e)`);
      if (this.folderId() === n.id) this.folderId.set(n.parentId);
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
    }
    await this.store.load().catch(() => undefined);
  }

  // ---------------------------------------------------------------- drag and drop (ADMIN, wide screens)

  protected slideStart(e: DragEvent, n: Node): void {
    if (!this.auth.admin()) return;
    this.slide.set(n.id);
    e.dataTransfer?.setData('text/plain', String(n.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected slideEnd(): void {
    this.slide.set(null);
    this.hover.set(null);
  }

  protected onHover(e: DragEvent, target: Node | 'racine'): void {
    const id = this.slide();
    if (id == null) return;
    if (target !== 'racine' && (target.id === id || this.store.descendants(id).some((d) => d.id === target.id))) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.hover.set(target === 'racine' ? 'racine' : target.id);
  }

  /**
   * Moves the element on the server first: a refused move never shows. Dropping on the top zone
   * detaches the element.
   */
  protected async drop(e: DragEvent, target: Node | null): Promise<void> {
    e.preventDefault();
    const id = this.slide();
    this.slideEnd();
    const element = id != null ? this.store.byId().get(id) : null;
    if (!element || element.parentId === (target?.id ?? null)) return;
    try {
      await firstValueFrom(this.api.move(element.id, target?.id ?? null));
      this.toasts.info(target ? `« ${element.name} » déplacé(e) dans « ${target.name} »` : `« ${element.name} » n'est plus rattaché(e)`);
      if (target) this.folded.update((s) => new Set([...s].filter((x) => x !== target.id)));
    } catch (err) {
      this.toasts.error('Déplacement impossible', errorMessage(err));
    }
    await this.store.load().catch(() => undefined);
  }
}
