import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { RoomState, stateOf, offSetpoint } from '../../core/state';
import { ConfirmService, ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { followSelectionBar } from '../../ui/selection-bar';
import { PlatformService } from '../../core/platform';
import { normalize } from '../../core/text';
import { TransitionsService } from '../../core/transitions';
import { UnitService, parseNumber } from '../../core/unit';
import { Node, RoomKind } from '../../models/models';
import { TreeStore, ICONS, LABELS, KIND_ORDER, PARENTS } from '../../services/tree.store';
import { ClimateService } from '../../services/climate.service';
import { AccessStore } from '../../services/access.store';
import { GroupService } from '../../services/group.service';
import { HierarchyService } from '../../services/hierarchy.service';
import { RoomService } from '../../services/room.service';
import { UserService } from '../../services/user.service';
import { Option, TbMultipleChoice } from '../../ui/multiple-choice';
import { TbStepper, TbSwitch } from '../../ui/controls';
import { TbSheet } from '../../ui/sheet';
import { TbMore } from '../../ui/more';
import { ElementDialog } from '../rooms/element-dialog';
import { AccessTab } from './access';

/** One row: an element with its place, temperature and setpoint (Celsius). */
interface Row {
  n: Node;
  path: string;
  state: RoomState;
  device: boolean;
  /** Phones, tree order: depth under the top level, and how many elements it contains. */
  depth?: number;
  children?: number;
}

const PER_PAGE = 50;

/**
 * Room management (gestion.xhtml), MANAGER and ADMIN: every building, floor, room and box
 * the user may see in one table. A MANAGER sets setpoints, one by one or for a selection; an
 * ADMIN also creates, renames, moves, deletes and gives accesses, and has the « Utilisateurs et
 * groupes » tab.
 *
 * On a phone, a list instead of the table: a row opens what can be done with its element (its
 * setpoint first), « Sélectionner » (or holding a row) acts on several at once, as in native apps.
 */
@Component({
  selector: 'tb-management',
  imports: [RouterLink, TbSheet, TbSwitch, TbStepper, TbMultipleChoice, ElementDialog, AccessTab, TbMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './management.html',
})
export class ManagementPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(TreeStore);
  protected readonly unit = inject(UnitService);
  private readonly climate = inject(ClimateService);
  private readonly hierarchy = inject(HierarchyService);
  private readonly rooms = inject(RoomService);
  private readonly access = inject(AccessStore);
  private readonly users = inject(UserService);
  private readonly groupsApi = inject(GroupService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly platform = inject(PlatformService);
  private readonly flip = inject(FlipService);
  private readonly transitions = inject(TransitionsService);

  /** Phone-sized screen: list, sheets, selection mode. */
  protected readonly phone = this.platform.phone;

  private readonly dialog = viewChild(ElementDialog);
  private readonly accessTab = viewChild(AccessTab);

  protected readonly icons = ICONS;
  protected readonly labels = LABELS;

  /** "salles" or "droits" (ADMIN: users and groups). */
  protected readonly tab = signal<'rooms' | 'access'>('rooms');

  // Filters
  protected readonly search = signal('');
  protected readonly type = signal<RoomKind | null>(null);
  protected readonly onlyToHandle = signal(false);
  protected readonly page = signal(0);

  protected readonly selection = signal<Set<number>>(new Set());
  /** Setpoint typed on each row, in the unit of the Preferences page. */
  protected readonly inputs = signal<Map<number, string>>(new Map());
  protected readonly sending = signal<number | null>(null);

  protected readonly types = computed(() => KIND_ORDER.filter((k) => k !== 'DEVICE' || this.auth.seesDevices()));

  protected readonly rows = computed<Row[]>(() =>
    this.store
      .nodes()
      .filter((n) => n.accessible && (n.kind !== 'DEVICE' || this.auth.seesDevices()))
      .map((n) => ({ n, path: this.store.pathText(n.id), state: stateOf(n.temperature, n.kind === 'DEVICE' ? null : n.setpoint?.value), device: n.kind === 'DEVICE' }))
      .sort((a, b) => normalize(a.path).localeCompare(normalize(b.path), 'fr') || KIND_ORDER.indexOf(a.n.kind) - KIND_ORDER.indexOf(b.n.kind) || normalize(a.n.name).localeCompare(normalize(b.n.name), 'fr')),
  );

  /** Off its setpoint, or a box not attached. */
  protected toHandle(l: Row): boolean {
    return offSetpoint(l.state) || (l.device && !l.n.attached);
  }

  protected readonly visible = computed(() => {
    const word = normalize(this.search().trim());
    return this.rows().filter(
      (l) =>
        (this.type() == null || l.n.kind === this.type()) &&
        (!word || normalize(`${l.n.name} ${l.path}`).includes(word)) &&
        (!this.onlyToHandle() || this.toHandle(l)),
    );
  });
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.visible().length / PER_PAGE)));
  protected readonly pageNumbers = computed(() => Array.from({ length: this.pages() }, (_, i) => i));
  protected readonly pageRows = computed(() => {
    const p = Math.min(this.page(), this.pages() - 1);
    return this.visible().slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  });
  protected readonly selectedRows = computed(() => this.rows().filter((l) => this.selection().has(l.n.id)));
  protected readonly allChecked = computed(() => this.pageRows().length > 0 && this.pageRows().every((l) => this.selection().has(l.n.id)));

  protected count(k: RoomKind | null): number {
    return k == null ? this.rows().length : this.rows().filter((l) => l.n.kind === k).length;
  }
  protected readonly toHandleCount = computed(() => this.rows().filter((l) => this.toHandle(l)).length);

  constructor() {
    followSelectionBar(() => this.tab() === 'rooms' && this.barVisible());
    // « À traiter »: the page turns to the colour of what is to be done, as the JSF one
    effect(() => this.transitions.setTone(this.onlyToHandle() && this.tab() === 'rooms' ? 'heating' : null));
    inject(DestroyRef).onDestroy(() => this.transitions.setTone(null));
    // Leaving the phone layout (rotation, wider window): no selection mode left behind
    effect(() => {
      if (!this.phone()) this.selectionMode.set(false);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.store.load(this.store.tree() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les éléments', errorMessage(e));
    }
  }

  protected openTab(o: 'rooms' | 'access'): void {
    this.tab.set(o === 'access' && this.auth.admin() ? 'access' : 'rooms');
  }

  // ---------------------------------------------------------------- phones

  protected readonly selectionMode = signal(false);
  /** Rows shown on a phone: 50 more at a time. */
  protected readonly phoneLimit = signal(50);

  /**
   * Phones, nothing searched or filtered: the elements in the order of the tree, each one under
   * the one that contains it (building → floor → room → device), indented, and folded on demand.
   * A flat list sorted by place showed a building's floors after the other buildings.
   */
  protected readonly asTree = computed(() => this.phone() && !this.search().trim() && this.type() == null && !this.onlyToHandle());
  /** Folded elements (their content hidden). */
  protected readonly folded = signal<Set<number>>(new Set());
  protected readonly treeRows = computed<Row[]>(() => {
    const byId = new Map(this.rows().map((l) => [l.n.id, l]));
    const children = this.store.children();
    const folded = this.folded();
    const res: Row[] = [];
    const count = (id: number): number => (children.get(id) ?? []).reduce((n, c) => n + (byId.has(c.id) ? 1 : 0) + (byId.has(c.id) ? 0 : count(c.id)), 0);
    const visit = (n: Node, depth: number) => {
      const l = byId.get(n.id);
      // An element the user may not manage (a building around their rooms): its content shown at its place
      if (l) res.push({ ...l, depth, children: count(n.id) });
      if (l && folded.has(n.id)) return;
      for (const c of children.get(n.id) ?? []) visit(c, l ? depth + 1 : depth);
    };
    for (const r of this.store.roots()) visit(r, 0);
    return res;
  });
  /** What the phone list shows. */
  protected readonly listRows = computed(() => (this.asTree() ? this.treeRows() : this.visible()));
  protected readonly phoneRows = computed(() => this.listRows().slice(0, this.phoneLimit()));

  protected fold(l: Row, ev: Event): void {
    ev.stopPropagation();
    this.flip.animate(() =>
      this.folded.update((s) => {
        const t = new Set(s);
        if (t.has(l.n.id)) t.delete(l.n.id);
        else t.add(l.n.id);
        return t;
      }),
    );
  }
  /** Actions of the ticked rows: on a phone, only in selection mode. */
  protected readonly barVisible = computed(() => this.selection().size > 0 && (!this.phone() || this.selectionMode()));

  protected toggleSelectionMode(): void {
    this.selectionMode.update((m) => !m);
    if (!this.selectionMode()) this.selection.set(new Set());
    this.platform.vibrate();
  }

  /** A row: ticked or not in selection mode, else the sheet of its element. */
  protected touchRow(l: Row): void {
    if (this.longPress) {
      this.longPress = false;
      return;
    }
    if (this.selectionMode()) {
      this.check(l.n.id, !this.selection().has(l.n.id));
      this.platform.vibrate();
      return;
    }
    this.openSheet(l);
  }

  private pressTimer?: ReturnType<typeof setTimeout>;
  private longPress = false;

  /** Holding a row: selection mode, starting with it. */
  protected longPressStart(l: Row, e: PointerEvent): void {
    if (this.selectionMode() || e.pointerType === 'mouse') return;
    clearTimeout(this.pressTimer);
    const x = e.clientX;
    const y = e.clientY;
    const target = e.currentTarget as HTMLElement;
    const cancel = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.type === 'pointermove' && Math.hypot(ev.clientX - x, ev.clientY - y) < 10) return;
      clearTimeout(this.pressTimer);
      for (const t of ['pointerup', 'pointercancel', 'pointermove']) target.removeEventListener(t, cancel);
    };
    for (const t of ['pointerup', 'pointercancel', 'pointermove']) target.addEventListener(t, cancel);
    this.pressTimer = setTimeout(() => {
      cancel(new Event('fin'));
      this.longPress = true;
      setTimeout(() => (this.longPress = false), 600);
      this.selectionMode.set(true);
      this.selection.set(new Set([l.n.id]));
      this.platform.vibrate(true);
    }, 480);
  }

  // Sheet of one element
  protected readonly sheetOpen = signal(false);
  protected readonly asSheet = signal<Row | null>(null);
  /** In the unit of the Preferences page. */
  protected readonly sheetSetpoint = signal<number | null>(null);

  private openSheet(l: Row): void {
    this.asSheet.set(l);
    const c = l.n.setpoint?.value;
    this.sheetSetpoint.set(c == null ? null : Math.round(this.unit.fromCelsius(c) * 10) / 10);
    this.force.set(false);
    this.sheetOpen.set(true);
  }

  protected async sendFromSheet(e: Event, l: Row): Promise<void> {
    e.preventDefault();
    const v = this.sheetSetpoint();
    if (v == null) {
      this.toasts.warn('Indique la consigne à envoyer');
      return;
    }
    this.sending.set(l.n.id);
    const ok = await this.send([l], v, this.force());
    this.sending.set(null);
    if (ok) this.sheetOpen.set(false);
  }

  /** An action of the sheet, done as for a selection of this element alone. */
  protected fromSheet(l: Row, action: 'edit' | 'access' | 'delete'): void {
    this.sheetOpen.set(false);
    if (action === 'edit') this.edit(l);
    else if (action === 'delete') void this.remove(l);
    else {
      this.selection.set(new Set([l.n.id]));
      void this.openAccess();
    }
  }

  protected filterType(k: RoomKind | null): void {
    this.flip.animate(() => {
      this.type.update((t) => (t === k ? null : k));
      // "Tout": every element again
      if (k == null) this.onlyToHandle.set(false);
      this.page.set(0);
      this.phoneLimit.set(50);
    });
  }

  protected toggleToHandle(): void {
    this.flip.animate(() => {
      this.onlyToHandle.update((v) => !v);
      this.page.set(0);
      this.phoneLimit.set(50);
    });
  }

  protected onSearch(v: string): void {
    this.flip.animate(() => {
      this.search.set(v);
      this.page.set(0);
      this.phoneLimit.set(50);
    });
  }

  // ---------------------------------------------------------------- selection

  protected check(id: number, isChecked: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      if (isChecked) r.add(id);
      else r.delete(id);
      return r;
    });
  }

  protected checkAll(isChecked: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      for (const l of this.pageRows()) {
        if (isChecked) r.add(l.n.id);
        else r.delete(l.n.id);
      }
      return r;
    });
  }

  protected uncheckAll(): void {
    this.selection.set(new Set());
  }

  // ---------------------------------------------------------------- consignes (MANAGER)

  protected enter(id: number, v: string): void {
    this.inputs.update((m) => new Map(m).set(id, v));
  }

  /** Setpoint of one row, typed in its field. */
  protected async apply(l: Row): Promise<void> {
    const input = parseNumber(this.inputs().get(l.n.id));
    if (input == null) {
      this.toasts.warn(`Indique une consigne pour « ${l.n.name} »`);
      return;
    }
    this.sending.set(l.n.id);
    if (await this.send([l], input, false)) {
      this.inputs.update((m) => {
        const r = new Map(m);
        r.delete(l.n.id);
        return r;
      });
    }
    this.sending.set(null);
  }

  // Setpoint of the selection (dialog)
  protected readonly dlgSetpoint = signal(false);
  protected readonly groupSetpoint = signal('');
  protected readonly force = signal(false);

  protected async applySelection(e: Event): Promise<void> {
    e.preventDefault();
    const v = parseNumber(this.groupSetpoint());
    if (v == null) {
      this.toasts.warn('Indique la consigne à envoyer');
      return;
    }
    if (await this.send(this.selectedRows(), v, this.force())) {
      this.groupSetpoint.set('');
      this.force.set(false);
      this.dlgSetpoint.set(false);
    }
  }

  private async send(targets: Row[], input: number, force: boolean): Promise<boolean> {
    const celsius = this.unit.inputToCelsius(input);
    const elements = targets.filter((l) => !l.device);
    if (!elements.length) {
      this.toasts.warn('Rien à régler', 'Une consigne se règle sur un bâtiment, un étage ou une salle.');
      return false;
    }
    const refused: string[] = [];
    let devices = 0;
    for (const l of elements) {
      try {
        devices += (await firstValueFrom(this.climate.sendSetpoint(l.n.id, celsius, force))).devices.length;
      } catch (e) {
        refused.push(`${l.n.name} (${errorMessage(e)})`);
      }
    }
    const succeeded = elements.length - refused.length;
    const text = `${this.unit.t(celsius)} ${this.unit.symbol()}`;
    if (succeeded > 0) this.toasts.info(`Consigne de ${text} pour ${succeeded} élément(s)`, `Envoyée à ${devices} boîtier(s)`);
    if (refused.length) this.toasts.error('Consigne refusée', refused.join(', '));
    await this.store.load(true).catch(() => undefined);
    return refused.length === 0;
  }

  // ---------------------------------------------------------------- structure (ADMIN)

  protected createNew(): void {
    const kind: RoomKind = this.type() && this.type() !== 'DEVICE' ? this.type()! : 'ROOM';
    const only = this.selectedRows().length === 1 ? this.selectedRows()[0].n : null;
    this.dialog()?.open({ kind, parentId: only && PARENTS[kind].includes(only.kind) ? only.id : null });
  }

  protected edit(l: Row): void {
    this.dialog()?.open({ element: l.n, kind: l.n.kind, parentId: l.n.parentId });
  }

  protected async afterSave(): Promise<void> {
    await this.store.load(true).catch(() => undefined);
  }

  // Move the selection (dialog)
  protected readonly dlgMove = signal(false);
  protected readonly targetId = signal<number | null>(null);

  /** Where the whole selection can go: allowed for every selected kind. */
  protected readonly possibleTargets = computed(() => {
    const sel = this.selectedRows();
    const kinds = new Set(sel.map((l) => l.n.kind));
    const excluded = new Set(sel.flatMap((l) => [l.n.id, ...this.store.descendants(l.n.id).map((d) => d.id)]));
    return this.rows().filter((c) => !excluded.has(c.n.id) && [...kinds].every((k) => PARENTS[k].includes(c.n.kind)));
  });

  protected label(l: Row): string {
    return l.path ? `${l.n.name} (${LABELS[l.n.kind]}, ${l.path})` : `${l.n.name} (${LABELS[l.n.kind]})`;
  }

  /** Moves the selection into the chosen element (none: detaches it). */
  protected async moveSelection(): Promise<void> {
    const target = this.targetId() != null ? this.store.byId().get(this.targetId()!) : null;
    const refused: string[] = [];
    const sel = this.selectedRows();
    for (const l of sel) {
      try {
        await firstValueFrom(this.hierarchy.move(l.n.id, target?.id ?? null));
      } catch (e) {
        refused.push(`${l.n.name} (${errorMessage(e)})`);
      }
    }
    const ok = sel.length - refused.length;
    if (ok > 0) this.toasts.info(target ? `${ok} élément(s) déplacé(s) dans « ${target.name} »` : `${ok} élément(s) détaché(s)`);
    if (refused.length) this.toasts.error('Déplacement impossible', refused.join(', '));
    this.targetId.set(null);
    this.dlgMove.set(false);
    await this.store.load(true).catch(() => undefined);
  }

  protected async remove(l: Row): Promise<void> {
    if (!(await this.confirm.ask('Supprimer', `Supprimer « ${l.n.name} » ? Ce qu'il contient est gardé, sans rattachement.`, { confirm: 'Supprimer' }))) return;
    await this.deleteAll([l]);
  }

  protected async deleteSelection(): Promise<void> {
    const sel = this.selectedRows();
    if (!(await this.confirm.ask('Supprimer', `Supprimer les ${sel.length} éléments sélectionnés ? Ce qu'ils contiennent est gardé, sans rattachement.`, { confirm: 'Supprimer' }))) return;
    await this.deleteAll(sel);
  }

  private async deleteAll(targets: Row[]): Promise<void> {
    const refused: string[] = [];
    for (const l of targets) {
      try {
        await firstValueFrom(this.rooms.remove(l.n.id));
      } catch (e) {
        refused.push(`${l.n.name} (${errorMessage(e)})`);
      }
    }
    const ok = targets.length - refused.length;
    if (ok > 0) this.toasts.info(`${ok} élément(s) supprimé(s)`);
    if (refused.length) this.toasts.error('Suppression impossible', refused.join(', '));
    this.selection.set(new Set());
    await this.store.load(true).catch(() => undefined);
  }

  // ---------------------------------------------------------------- accesses of the selection (ADMIN)

  protected readonly dlgAccess = signal(false);
  protected readonly usersAccess = signal<Set<number>>(new Set());
  protected readonly groupAccess = signal<Set<number>>(new Set());

  /** Users who can be given accesses: not the ADMINs, who see everything anyway. */
  protected readonly userOptions = computed<Option[]>(() =>
    this.access.users().filter((l) => l.user.type !== 'ADMIN').map((l) => ({ id: l.user.id!, label: l.user.username })),
  );
  protected readonly groupOptions = computed<Option[]>(() => this.access.groups().map((g) => ({ id: g.id, label: g.name })));

  protected async openAccess(): Promise<void> {
    this.usersAccess.set(new Set());
    this.groupAccess.set(new Set());
    this.dlgAccess.set(true);
    if (!this.access.loaded()) await this.access.load().catch((e) => this.toasts.error('Impossible de charger les utilisateurs', errorMessage(e)));
  }

  /**
   * The selected buildings, floors and rooms (and what they contain) for the chosen users and
   * groups. A user who sees everything already has them and can't lose them (limit them first in
   * « Utilisateurs et groupes »).
   */
  protected async changeAccess(grant: boolean): Promise<void> {
    const elements = this.selectedRows().filter((l) => !l.device).map((l) => l.n.id);
    if (!elements.length) {
      this.toasts.warn('Sélectionne des bâtiments, étages ou salles');
      return;
    }
    if (!this.usersAccess().size && !this.groupAccess().size) {
      this.toasts.warn('Choisis des utilisateurs ou des groupes');
      return;
    }
    const done: string[] = [];
    const ignored: string[] = [];
    // Their accesses as they are now, before changing them
    await this.access.ensure([...this.usersAccess()]);
    for (const id of this.usersAccess()) {
      const l = this.access.byId().get(id);
      if (!l) continue;
      if (l.unlimited) {
        ignored.push(`${l.user.username} (voit déjà tout)`);
        continue;
      }
      const current = (l.access?.elements ?? []).map((e) => e.id);
      const added = grant ? [...new Set([...current, ...elements])] : current.filter((x) => !elements.includes(x));
      try {
        await firstValueFrom(this.users.setAccess(id, true, added));
        done.push(l.user.username);
      } catch (e) {
        ignored.push(`${l.user.username} (${errorMessage(e)})`);
      }
    }
    for (const id of this.groupAccess()) {
      const g = this.access.groups().find((x) => x.id === id);
      if (!g) continue;
      const req = GroupService.query(g);
      req.elements = grant ? [...new Set([...req.elements, ...elements])] : req.elements.filter((x) => !elements.includes(x));
      try {
        await firstValueFrom(this.groupsApi.edit(g.id, req));
        done.push(`groupe ${g.name}`);
      } catch (e) {
        ignored.push(`groupe ${g.name} (${errorMessage(e)})`);
      }
    }
    if (done.length) this.toasts.info((grant ? 'Accès donné à ' : 'Accès retiré à ') + done.join(', '), `${elements.length} élément(s) et leur contenu`);
    if (ignored.length) this.toasts.warn('Non modifié', ignored.join(', '));
    this.dlgAccess.set(false);
    if (this.phone() && !this.selectionMode()) this.selection.set(new Set());
    await this.access.load().catch(() => undefined);
  }

  /** Main action of the page (header button): a new element or a new group. */
  protected newGroup(): void {
    this.accessTab()?.newGroup();
  }
}
