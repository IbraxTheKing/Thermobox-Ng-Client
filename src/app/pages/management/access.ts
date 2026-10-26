import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild, effect, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { initial } from '../../core/text';
import { Group, ROLES, UserRole } from '../../models/models';
import { TreeStore } from '../../services/tree.store';
import { AccessStore, UserRow } from '../../services/access.store';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { TbAccessTree } from '../../ui/access-tree';
import { Option, TbMultipleChoice } from '../../ui/multiple-choice';
import { TbSheet } from '../../ui/sheet';
import { ShownCount, TbMore } from '../../ui/more';
import { TbSwitch } from '../../ui/controls';
import { PlatformService } from '../../core/platform';
import { FlipService } from '../../core/flip';
import { followSelectionBar } from '../../ui/selection-bar';

/**
 * « Utilisateurs et groupes » tab of the Gestion page (ADMIN only, gestion-droits.xhtml): roles
 * and accesses of several users at once, and groups of users that give access to buildings, floors
 * and rooms.
 */
@Component({
  selector: 'tb-access',
  imports: [TbSheet, TbSwitch, TbMultipleChoice, TbAccessTree, TbMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access.html',
})
export class AccessTab implements OnInit {
  constructor() {
    followSelectionBar(() => this.selection().size > 0 && !this.phone());
    effect(() => {
      this.search();
      untracked(() => this.shown.reset());
    });
    // The accesses of the users shown, as they are shown
    effect(() => {
      const ids = this.shownRows().map((l) => l.user.id!);
      untracked(() => void this.access.ensure(ids));
    });
  }

  protected readonly auth = inject(AuthService);
  protected readonly access = inject(AccessStore);
  protected readonly tree = inject(TreeStore);
  private readonly users = inject(UserService);
  private readonly groupsApi = inject(GroupService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly phone = inject(PlatformService).phone;
  private readonly flip = inject(FlipService);

  protected onSearch(v: string): void {
    this.flip.animate(() => this.search.set(v));
  }

  private readonly groupTree = viewChild(TbAccessTree);

  protected readonly roles = ROLES;
  protected readonly search = signal('');
  protected readonly selection = signal<Set<number>>(new Set());

  protected readonly visible = computed(() => {
    const word = this.search().trim().toLowerCase();
    return this.access.users().filter((l) => !word || l.user.username.toLowerCase().includes(word) || l.groups.some((g) => g.toLowerCase().includes(word)));
  });
  /** Hundreds of accounts: a part at a time, their accesses read as they are shown. */
  protected readonly shown = new ShownCount(50);
  protected readonly shownRows = computed(() => this.visible().slice(0, this.shown.count()));
  protected readonly selectedRows = computed(() => this.access.users().filter((l) => this.selection().has(l.user.id!)));
  protected readonly allChecked = computed(() => this.visible().length > 0 && this.visible().every((l) => this.selection().has(l.user.id!)));

  protected summary = AccessStore.shortSummary;
  protected noAccess = AccessStore.noAccess;
  protected initial = initial;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.access.load();
      // Keep the selection on what still exists
      const ids = new Set(this.access.users().map((l) => l.user.id!));
      this.selection.update((s) => new Set([...s].filter((id) => ids.has(id))));
    } catch (e) {
      this.toasts.error('Impossible de charger les utilisateurs', errorMessage(e));
    }
  }

  protected roleName(r: UserRole | null | undefined): string {
    return r ? ({ ADMIN: 'Admin', MANAGER: 'Gestionnaire', VIEWER: 'Lecteur' }[r] ?? r) : '';
  }

  // ---------------------------------------------------------------- phones: one user in a sheet

  protected readonly userSheet = signal(false);
  private readonly sheetId = signal<number | null>(null);
  /** Follows the reloads: the sheet shows what was just changed. */
  protected readonly asSheet = computed(() => this.access.users().find((l) => l.user.id === this.sheetId()) ?? null);

  protected openUser(l: UserRow): void {
    this.sheetId.set(l.user.id!);
    this.userSheet.set(true);
  }

  protected async seesAll(l: UserRow, all: boolean): Promise<void> {
    this.selection.set(new Set([l.user.id!]));
    await this.selectionAccess(all);
    this.selection.set(new Set());
  }

  /** Group membership of this user (same window as for a selection). */
  protected groupsOf(l: UserRow): void {
    this.selection.set(new Set([l.user.id!]));
    this.targetGroupId.set(null);
    this.userSheet.set(false);
    this.dlgMembers.set(true);
  }

  protected check(id: number, isChecked: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      if (isChecked) r.add(id);
      else r.delete(id);
      return r;
    });
  }

  protected checkAll(isChecked: boolean): void {
    this.selection.set(isChecked ? new Set(this.visible().map((l) => l.user.id!)) : new Set());
  }

  // ---------------------------------------------------------------- roles

  protected changeRole(l: UserRow, role: string): void {
    void this.applyRole([l], role as UserRole);
  }

  protected readonly dlgRole = signal(false);
  protected readonly groupRole = signal<UserRole | null>(null);

  protected async applyRoleSelection(): Promise<void> {
    const role = this.groupRole();
    if (!role) {
      this.toasts.warn('Choisis un rôle');
      return;
    }
    await this.applyRole(this.selectedRows(), role);
    this.groupRole.set(null);
    this.dlgRole.set(false);
  }

  private async applyRole(targets: UserRow[], role: UserRole): Promise<void> {
    let n = 0;
    const ignored: string[] = [];
    for (const l of targets) {
      // Never lock oneself out of administration
      if (this.auth.isMe(l.user) && role !== 'ADMIN') {
        ignored.push(`${l.user.username} (votre propre compte)`);
        continue;
      }
      if (l.user.type === role) continue;
      try {
        await firstValueFrom(this.users.update(l.user.id!, { type: role }));
        n++;
      } catch (e) {
        ignored.push(`${l.user.username} (${errorMessage(e)})`);
      }
    }
    if (n > 0) this.toasts.info(`Rôle ${role} pour ${n} utilisateur(s)`, role !== 'ADMIN' ? "Un ancien administrateur n'a plus accès à rien tant que vous ne lui en donnez pas." : null);
    if (ignored.length) this.toasts.warn('Non modifié', ignored.join(', '));
    await this.load();
  }

  // ---------------------------------------------------------------- accesses

  /** Sees everything ([tout]) or only their accesses and groups. */
  protected async selectionAccess(all: boolean): Promise<void> {
    // Their accesses as they are now, before changing them
    await this.access.ensure([...this.selection()]);
    let n = 0;
    for (const l of this.selectedRows().filter((x) => x.user.type !== 'ADMIN')) {
      try {
        await firstValueFrom(this.users.setAccess(l.user.id!, !all, all ? [] : (l.access?.elements ?? []).map((e) => e.id)));
        n++;
      } catch (e) {
        this.toasts.error(`Accès de ${l.user.username} non modifiés`, errorMessage(e));
      }
    }
    this.toasts.info(all ? `${n} utilisateur(s) voient tout ThermoBox` : `${n} utilisateur(s) limités à leurs accès et groupes`);
    await this.load();
  }

  // ---------------------------------------------------------------- group membership

  protected readonly dlgMembers = signal(false);
  protected readonly targetGroupId = signal<number | null>(null);

  protected async members(add: boolean): Promise<void> {
    const g = this.access.groups().find((x) => x.id === this.targetGroupId());
    if (!g) {
      this.toasts.warn('Choisis un groupe');
      return;
    }
    const ids = this.selectedRows().map((l) => l.user.id!);
    const req = GroupService.query(g);
    req.members = add ? [...new Set([...req.members, ...ids])] : req.members.filter((m) => !ids.includes(m));
    try {
      await firstValueFrom(this.groupsApi.edit(g.id, req));
      this.toasts.info(add ? `${ids.length} utilisateur(s) ajouté(s) à « ${g.name} »` : `${ids.length} utilisateur(s) retiré(s) de « ${g.name} »`);
      this.dlgMembers.set(false);
      if (this.phone()) this.selection.set(new Set());
    } catch (e) {
      this.toasts.error('Groupe non modifié', errorMessage(e));
    }
    await this.load();
  }

  // ---------------------------------------------------------------- groups

  protected readonly dlgGroup = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly formName = signal('');
  protected readonly formDescription = signal('');
  protected readonly formMembers = signal<Set<number>>(new Set());
  protected readonly formChecked = signal<Set<number>>(new Set());
  protected readonly formSubmitted = signal(false);

  protected readonly memberOptions = computed<Option[]>(() =>
    this.access.users().map((l) => ({ id: l.user.id!, label: l.user.username, detail: `(${l.user.type})` })),
  );

  async newGroup(): Promise<void> {
    await this.prepareTree();
    this.editingId.set(null);
    this.formName.set('');
    this.formDescription.set('');
    this.formMembers.set(new Set(this.selection()));
    this.formChecked.set(new Set());
    this.formSubmitted.set(false);
    this.dlgGroup.set(true);
  }

  protected async editGroup(g: Group): Promise<void> {
    await this.prepareTree();
    this.editingId.set(g.id);
    this.formName.set(g.name);
    this.formDescription.set(g.description ?? '');
    this.formMembers.set(new Set(g.members.map((m) => m.id)));
    this.formChecked.set(TbAccessTree.check(this.tree.nodes(), g.elements.map((e) => e.id)));
    this.formSubmitted.set(false);
    this.dlgGroup.set(true);
  }

  private async prepareTree(): Promise<void> {
    if (!this.tree.tree()) await this.tree.load().catch(() => undefined);
  }

  protected async saveGroup(e: Event): Promise<void> {
    e.preventDefault();
    this.formSubmitted.set(true);
    const name = this.formName().trim();
    if (!name) return;
    const elements = this.groupTree()?.kept() ?? [];
    const req = { name: name, description: this.formDescription().trim() || null, members: [...this.formMembers()], elements };
    try {
      const id = this.editingId();
      const g = id != null ? await firstValueFrom(this.groupsApi.edit(id, req)) : await firstValueFrom(this.groupsApi.create(req));
      this.toasts.info(`Groupe « ${g.name} » enregistré`, `${req.members.length} membre(s), ${elements.length} élément(s) et leur contenu`);
      this.dlgGroup.set(false);
      await this.load();
    } catch (err) {
      this.toasts.error('Groupe non enregistré', errorMessage(err));
    }
  }

  protected async deleteGroup(g: Group): Promise<void> {
    if (!(await this.confirm.ask('Supprimer', `Supprimer le groupe « ${g.name} » ? Ses membres gardent leurs propres accès.`, { confirm: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.groupsApi.remove(g.id));
      this.toasts.info(`Groupe « ${g.name} » supprimé`, 'Ses membres gardent leurs propres accès.');
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
    }
    await this.load();
  }
}
