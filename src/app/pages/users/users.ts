import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { FlipService } from '../../core/flip';
import { UpdateNoticeService } from '../../core/update-notice';
import { ConfirmService, ToastService } from '../../core/messages';
import { initial } from '../../core/text';
import { ROLES, User, UserRole } from '../../models/models';
import { TreeStore } from '../../services/tree.store';
import { AccessStore, UserRow } from '../../services/access.store';
import { UserService } from '../../services/user.service';
import { TbAccessTree } from '../../ui/access-tree';
import { TbPassword } from '../../ui/controls';
import { TbSheet } from '../../ui/sheet';
import { bytes } from '../auth/register';

/** Utilisateurs (users.xhtml), ADMIN: accounts, their role and what they may see. */
@Component({
  selector: 'tb-users-page',
  imports: [RouterLink, TbSheet, TbPassword, TbAccessTree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.html',
})
export class UsersPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly notice = inject(UpdateNoticeService);
  protected readonly access = inject(AccessStore);
  private readonly flip = inject(FlipService);

  protected onSearch(v: string): void {
    this.flip.animate(() => this.search.set(v));
  }
  protected readonly tree = inject(TreeStore);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly accessTree = viewChild(TbAccessTree);

  protected readonly roles = ROLES;
  protected roleName(r: string | null | undefined): string {
    return r ? (({ ADMIN: 'Administrateur', MANAGER: 'Gestionnaire', VIEWER: 'Lecteur' }) as Record<string, string>)[r] ?? r : '';
  }
  protected readonly search = signal('');
  /** Role chip picked, null for all. */
  protected readonly roleFilter = signal<UserRole | null>(null);

  protected readonly visible = computed(() => {
    const word = this.search().trim().toLowerCase();
    return this.access.users().filter((l) => (!word || l.user.username.toLowerCase().includes(word)) && (this.roleFilter() == null || l.user.type === this.roleFilter()));
  });

  protected count(r: UserRole): number {
    return this.access.users().filter((l) => l.user.type === r).length;
  }

  protected initial = initial;
  protected summary = AccessStore.longSummary;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.access.load();
    } catch (e) {
      this.toasts.error('Impossible de charger les utilisateurs', errorMessage(e));
    }
  }

  protected toggleRole(r: UserRole): void {
    this.roleFilter.update((x) => (x === r ? null : r));
  }

  // ---------------------------------------------------------------- create / edit

  protected readonly dlgUser = signal(false);
  protected readonly selected = signal<User | null>(null);
  protected readonly formName = signal('');
  protected readonly formRole = signal<UserRole | ''>('');
  protected readonly formPassword = signal('');
  protected readonly formSubmitted = signal(false);
  protected readonly creation = computed(() => this.selected()?.id == null);

  protected readonly nameError = computed(() => {
    const n = this.formName().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    return null;
  });
  protected readonly passwordError = computed(() => {
    const p = this.formPassword();
    if (!p) return this.creation() ? 'Mot de passe obligatoire' : null;
    if (p.length < 8) return 'Au moins 8 caractères';
    if (bytes(p) > 72) return 'Trop long (72 octets au plus)';
    return null;
  });

  protected create(): void {
    this.selected.set({ username: '' });
    this.formName.set('');
    this.formRole.set('');
    this.formPassword.set('');
    this.formSubmitted.set(false);
    this.dlgUser.set(true);
  }

  protected edit(u: User): void {
    this.selected.set(u);
    this.formName.set(u.username);
    this.formRole.set(u.type ?? '');
    this.formPassword.set('');
    this.formSubmitted.set(false);
    this.dlgUser.set(true);
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.formSubmitted.set(true);
    const role = this.formRole();
    if (this.nameError() || this.passwordError() || !role) return;
    const name = this.formName().trim();
    const u = this.selected();
    try {
      if (this.creation()) {
        // A new account is a VIEWER: its role is then set as chosen
        await firstValueFrom(this.users.add({ username: name, password: this.formPassword() }));
        const created = await firstValueFrom(this.users.getByUsername(name));
        if (created?.id != null && role !== 'VIEWER') await firstValueFrom(this.users.update(created.id, { type: role }));
        this.toasts.info(`Utilisateur « ${name} » créé`, role === 'ADMIN' ? null : "Il n'a encore accès à aucune salle : donnez-lui des accès avec le bouton Accès.");
      } else if (u?.id != null) {
        const update = await firstValueFrom(this.users.update(u.id, { username: name, type: role, ...(this.formPassword() ? { password: this.formPassword() } : {}) }));
        if (this.auth.isMe(u)) this.auth.updateUser(update);
        this.toasts.info(`Utilisateur « ${name} » modifié`);
      }
      this.dlgUser.set(false);
      await this.load();
    } catch (err) {
      const m = errorMessage(err, 'Enregistrement impossible');
      this.toasts.error(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : 'Enregistrement impossible', m === 'Username already taken' ? null : m);
    }
  }

  protected async remove(u: User): Promise<void> {
    if (this.auth.isMe(u)) {
      this.toasts.error('Supprime ton propre compte depuis la page Profil');
      return;
    }
    if (!(await this.confirm.ask('Supprimer', `Supprimer l'utilisateur « ${u.username} » ?`, { confirm: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.users.remove(u.id!));
      this.toasts.info(`Utilisateur « ${u.username} » supprimé`);
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
    }
    await this.load();
  }

  // ---------------------------------------------------------------- accesses

  protected readonly dlgAccess = signal(false);
  protected readonly userAccess = signal<UserRow | null>(null);
  /** false: sees everything; true: only what is ticked. */
  protected readonly restrictedAccess = signal(true);
  protected readonly checkedAccess = signal<Set<number>>(new Set());

  protected async openAccess(l: UserRow): Promise<void> {
    if (!this.tree.tree()) await this.tree.load().catch(() => undefined);
    try {
      const a = await firstValueFrom(this.users.getAccess(l.user.id!));
      this.userAccess.set(l);
      this.restrictedAccess.set(a.restricted);
      this.checkedAccess.set(TbAccessTree.check(this.tree.nodes(), a.elements.map((e) => e.id)));
      this.dlgAccess.set(true);
    } catch (e) {
      this.toasts.error('Impossible de lire les accès', errorMessage(e));
    }
  }

  /**
   * An element counts with everything it contains (and what will be added to it later) only if it
   * is ticked with all its content; otherwise only its ticked content counts.
   */
  protected async saveAccess(): Promise<void> {
    const l = this.userAccess();
    if (!l) return;
    const elements = this.restrictedAccess() ? (this.accessTree()?.kept() ?? []) : [];
    try {
      await firstValueFrom(this.users.setAccess(l.user.id!, this.restrictedAccess(), elements));
      this.toasts.info(`Accès de « ${l.user.username} » enregistrés`, this.restrictedAccess() ? `${elements.length} élément(s) et leur contenu` : 'Accès à tout');
      this.dlgAccess.set(false);
      await this.load();
    } catch (e) {
      this.toasts.error('Enregistrement impossible', errorMessage(e));
    }
  }
}
