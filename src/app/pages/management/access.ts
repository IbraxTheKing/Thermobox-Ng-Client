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
import { TbPager } from '../../ui/pager';
import { TbUserAccessSheet } from '../../ui/user-access-sheet';
import { TbUserGroupsSheet } from '../../ui/user-groups-sheet';
import { TbUserFormSheet } from '../../ui/user-form-sheet';
import { TbSwitch } from '../../ui/controls';
import { PlatformService } from '../../core/platform';
import { FlipService } from '../../core/flip';
import { followSelectionBar } from '../../ui/selection-bar';

/**
 * « Utilisateurs et groupes » tab of the Gestion page (ADMIN only, gestion-droits.xhtml): roles
 * and accesses of several users at once, and groups of users that give access to buildings, floors
 * and rooms.
 */
/** Users per page. */
const PAGE = 20;
/** « Sans groupe » in the group filter. */
const NO_GROUP = -1;

@Component({
  selector: 'tb-access',
  imports: [TbSheet, TbSwitch, TbMultipleChoice, TbAccessTree, TbPager, TbUserAccessSheet, TbUserGroupsSheet, TbUserFormSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access.html',
})
export class AccessTab implements OnInit {
  constructor() {
    followSelectionBar(() => this.selection().size > 0 && !this.phone());
    effect(() => {
      this.search();
      this.roleFilter();
      this.groupFilter();
      untracked(() => this.page.set(0));
    });
    effect(() => {
      this.groupSearch();
      untracked(() => this.groupPage.set(0));
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

  /** Roles ticked (none: all). */
  protected readonly roleFilter = signal<Set<UserRole>>(new Set());
  /** Groups ticked, NO_GROUP for the users in none (none ticked: all). A user in any of them shows. */
  protected readonly groupFilter = signal<Set<number>>(new Set());
  protected readonly groupsOpen = signal(false);
  protected readonly NO_GROUP = NO_GROUP;
  protected readonly groupChoices = computed<Option[]>(() => [
    { id: NO_GROUP, label: 'Sans groupe' },
    ...this.access.groups().map((g) => ({ id: g.id, label: g.name, detail: `${g.members.length}` })),
  ]);
  protected readonly filtering = computed(() => this.roleFilter().size > 0 || this.groupFilter().size > 0);
  /** « Équipe 1, Équipe 2 », « 4 groupes ». */
  protected readonly groupFilterText = computed(() => {
    const ids = [...this.groupFilter()];
    if (!ids.length) return 'Tous les groupes';
    const names = ids.map((id) => (id === NO_GROUP ? 'Sans groupe' : this.access.groups().find((g) => g.id === id)?.name ?? '?'));
    return names.length <= 2 ? names.join(', ') : `${names.length} groupes`;
  });

  protected readonly visible = computed(() => {
    const word = this.search().trim().toLowerCase();
    const roles = this.roleFilter();
    const gf = this.groupFilter();
    const members = new Set(this.access.groups().filter((g) => gf.has(g.id)).flatMap((g) => g.members.map((m) => m.id)));
    return this.access.users().filter(
      (l) =>
        (!word || l.user.username.toLowerCase().includes(word) || l.groups.some((g) => g.toLowerCase().includes(word))) &&
        (!roles.size || roles.has(l.user.type!)) &&
        (!gf.size || members.has(l.user.id!) || (gf.has(NO_GROUP) && !l.groups.length)),
    );
  });

  protected count(r: UserRole): number {
    return this.access.users().filter((l) => l.user.type === r).length;
  }

  protected toggleRole(r: UserRole): void {
    this.flip.animate(() =>
      this.roleFilter.update((x) => {
        const s = new Set(x);
        if (s.has(r)) s.delete(r);
        else s.add(r);
        return s;
      }),
    );
  }

  protected clearUserFilters(): void {
    this.roleFilter.set(new Set());
    this.groupFilter.set(new Set());
  }

  // ---------------------------------------------------------------- groups: a list

  protected readonly MEMBERS_SHOWN = 5;
  protected readonly groupSearch = signal('');
  protected readonly groupPage = signal(0);
  protected readonly visibleGroups = computed(() => {
    const word = this.groupSearch().trim().toLowerCase();
    return this.access
      .groups()
      .filter((g) => !word || g.name.toLowerCase().includes(word) || (g.description ?? '').toLowerCase().includes(word) || g.members.some((m) => (m.username ?? "").toLowerCase().includes(word)));
  });
  protected readonly shownGroups = computed(() => this.visibleGroups().slice(this.groupPage() * PAGE, this.groupPage() * PAGE + PAGE));

  /** « user021, user022, user023 et 12 autres » */
  protected firstNames(g: Group, n: number): string {
    const names = g.members.slice(0, n).map((m) => m.username).join(', ');
    return g.members.length > n ? `${names} et ${g.members.length - n} autre(s)` : names;
  }

  // ---------------------------------------------------------------- accounts

  protected readonly userForm = viewChild.required(TbUserFormSheet);

  newUser(): void {
    this.userForm().create();
  }

  protected editUser(l: UserRow): void {
    this.userSheet.set(false);
    this.userForm().edit(l.user);
  }

  protected async removeUser(l: UserRow): Promise<void> {
    if (await this.userForm().remove(l.user)) this.userSheet.set(false);
  }
  /** Users or groups shown. */
  readonly view = signal<'users' | 'groups'>('users');
  /** Hundreds of accounts: a page at a time, their accesses read as they are shown. */
  protected readonly page = signal(0);
  protected readonly pageSize = PAGE;
  protected readonly shownRows = computed(() => this.visible().slice(this.page() * PAGE, this.page() * PAGE + PAGE));
  protected readonly accessSheet = viewChild.required(TbUserAccessSheet);
  protected readonly groupsSheet = viewChild.required(TbUserGroupsSheet);
  protected readonly selectedRows = computed(() => this.access.users().filter((l) => this.selection().has(l.user.id!)));
  protected readonly allChecked = computed(() => this.visible().length > 0 && this.visible().every((l) => this.selection().has(l.user.id!)));

  protected summary = AccessStore.shortSummary;
  protected noAccess = AccessStore.noAccess;
  protected initial = initial;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
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
    this.userSheet.set(false);
    this.groupsSheet().open(l);
  }

  /** « Nouveau groupe » from the groups of a user: the group form, with them in it. */
  protected async newGroupWith(l: UserRow): Promise<void> {
    await this.newGroup();
    this.formMembers.set(new Set([l.user.id!]));
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
