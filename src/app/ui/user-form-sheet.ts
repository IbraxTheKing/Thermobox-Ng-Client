import { ChangeDetectionStrategy, Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../core/api.config';
import { AuthService } from '../core/auth';
import { ConfirmService, ToastService } from '../core/messages';
import { ROLES, User, UserRole } from '../models/models';
import { UserService } from '../services/user.service';
import { AccessStore } from '../services/access.store';
import { GroupService } from '../services/group.service';
import { TreeStore } from '../services/tree.store';
import { bytes } from '../pages/auth/register';
import { TbAccessTree } from './access-tree';
import { TbPassword } from './controls';
import { TbMultipleChoice } from './multiple-choice';
import { TbSheet } from './sheet';

/**
 * An account (ADMIN): created, renamed, its role or password changed, or deleted. The
 * « Utilisateurs et groupes » tab of the Gestion page.
 *
 *   <tb-user-form-sheet (saved)="reload()" />   …   form.create() / form.edit(user) / form.remove(user)
 */
@Component({
  selector: 'tb-user-form-sheet',
  imports: [TbSheet, TbPassword, TbMultipleChoice, TbAccessTree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" [title]="creation() ? 'Nouvel utilisateur' : 'Modifier l\\'utilisateur'" [width]="creation() ? 560 : 420">
      <form (submit)="save($event)" novalidate>
        <div class="tb-field">
          <label class="tb-label" for="tb-u-name">Nom d'utilisateur</label>
          <input id="tb-u-name" class="tb-input" autocomplete="off" autocapitalize="off" spellcheck="false" [value]="name()" (input)="name.set($any($event.target).value)"
                 [class.tb-invalid]="submitted() && nameError()" />
          @if (submitted() && nameError(); as e) {
            <span class="tb-field-error">{{ e }}</span>
          }
        </div>
        <div class="tb-field">
          <label class="tb-label" for="tb-u-role">Rôle</label>
          <select id="tb-u-role" class="tb-select" [class.tb-invalid]="submitted() && !role()" [disabled]="isMe()" (change)="role.set($any($event.target).value)">
            <option value="" [selected]="!role()">Choisir…</option>
            @for (r of roles; track r) {
              <option [value]="r" [selected]="role() === r">{{ roleName(r) }}</option>
            }
          </select>
          @if (submitted() && !role()) {
            <span class="tb-field-error">Rôle obligatoire</span>
          }
        </div>
        <div class="tb-field">
          <label class="tb-label" for="tb-u-password">{{ creation() ? 'Mot de passe' : 'Nouveau mot de passe (optionnel)' }}</label>
          <tb-password inputId="tb-u-password" [(value)]="password" autocomplete="new-password" [invalid]="!!(submitted() && passwordError())" />
          @if (submitted() && passwordError(); as e) {
            <span class="tb-field-error">{{ e }}</span>
          }
        </div>
        @if (creation()) {
          <!-- From the start: its groups and what it may see -->
          @if (access.groups().length) {
            <div class="tb-field">
              <span class="tb-label">Groupes (facultatif)</span>
              <tb-choice-multiple [options]="groupOptions()" [(value)]="groups" placeholder="Rechercher un groupe…" empty="Aucun groupe" />
            </div>
          }
          @if (role() !== 'ADMIN') {
            <div class="tb-field">
              <span class="tb-label">Accès</span>
              <div class="tb-access-mode" role="radiogroup" aria-label="Accès">
                <label class="tb-choice"><input type="radio" name="tb-new-access" [checked]="!restricted()" (change)="restricted.set(false)" />Tout ThermoBox</label>
                <label class="tb-choice"><input type="radio" name="tb-new-access" [checked]="restricted()" (change)="restricted.set(true)" />Seulement les éléments cochés{{ groups().size ? ' (en plus de ses groupes)' : '' }}</label>
              </div>
              @if (restricted()) {
                <tb-tree-access [nodes]="tree.nodes()" [(checked)]="checked" />
              }
            </div>
          } @else {
            <p class="tb-muted"><i class="pi pi-shield"></i> Un administrateur voit tout ThermoBox.</p>
          }
        }
        <div class="tb-actions">
          @if (!creation() && !isMe()) {
            <button type="button" class="tb-btn tb-flat tb-btn-danger tb-actions-start" (click)="removeShown()"><i class="pi pi-trash"></i>Supprimer</button>
          }
          <button type="button" class="tb-btn tb-flat" (click)="shown.set(false)">Annuler</button>
          <button type="submit" class="tb-btn" [disabled]="saving()"><i class="pi pi-check"></i>Enregistrer</button>
        </div>
      </form>
    </tb-sheet>
  `,
})
export class TbUserFormSheet {
  private readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly access = inject(AccessStore);
  protected readonly tree = inject(TreeStore);
  private readonly groupsApi = inject(GroupService);
  private readonly accessTree = viewChild(TbAccessTree);

  /** Creation: the groups it joins, and whether it sees everything or only what is ticked. */
  protected readonly groups = signal<Set<number>>(new Set());
  protected readonly restricted = signal(true);
  protected readonly checked = signal<Set<number>>(new Set());
  protected readonly groupOptions = computed(() => this.access.groups().map((g) => ({ id: g.id, label: g.name, detail: `${g.members.length} membre(s)` })));

  /** An account was created, changed or deleted. */
  readonly saved = output<void>();

  protected readonly roles = ROLES;
  protected readonly shown = signal(false);
  private readonly user = signal<User | null>(null);
  protected readonly name = signal('');
  protected readonly role = signal<UserRole | ''>('');
  protected readonly password = signal('');
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly creation = computed(() => this.user()?.id == null);
  protected readonly isMe = computed(() => !this.creation() && this.auth.isMe(this.user()!));

  protected readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    return null;
  });
  protected readonly passwordError = computed(() => {
    const p = this.password();
    if (!p) return this.creation() ? 'Mot de passe obligatoire' : null;
    if (p.length < 8) return 'Au moins 8 caractères';
    if (bytes(p) > 72) return 'Trop long (72 octets au plus)';
    return null;
  });

  protected roleName(r: string): string {
    return ({ ADMIN: 'Administrateur', MANAGER: 'Gestionnaire', VIEWER: 'Lecteur' } as Record<string, string>)[r] ?? r;
  }

  create(): void {
    this.groups.set(new Set());
    this.restricted.set(true);
    this.checked.set(new Set());
    if (!this.tree.tree()) void this.tree.load().catch(() => undefined);
    this.fill({ username: '' }, 'VIEWER');
  }

  edit(u: User): void {
    this.fill(u, u.type ?? '');
  }

  private fill(u: User, role: UserRole | ''): void {
    this.user.set(u);
    this.name.set(u.username);
    this.role.set(role);
    this.password.set('');
    this.submitted.set(false);
    this.shown.set(true);
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.submitted.set(true);
    const role = this.role();
    if (this.nameError() || this.passwordError() || !role) return;
    const name = this.name().trim();
    const u = this.user();
    this.saving.set(true);
    try {
      if (this.creation()) {
        // A new account is a VIEWER: its role is then set as chosen
        await firstValueFrom(this.users.add({ username: name, password: this.password() }));
        const created = await firstValueFrom(this.users.getByUsername(name));
        const id = created?.id;
        if (id != null && role !== 'VIEWER') await firstValueFrom(this.users.update(id, { type: role }));
        const extra = id != null ? await this.setUp(id, role) : [];
        const nothing = role !== 'ADMIN' && this.restricted() && !(this.accessTree()?.kept().length ?? 0) && !this.groups().size;
        this.toasts.info(
          `Utilisateur « ${name} » créé`,
          extra.length ? extra.join(', ') : nothing ? "Il n'a encore accès à aucune salle : touche ses accès pour lui en donner." : null,
        );
      } else if (u?.id != null) {
        const update = await firstValueFrom(this.users.update(u.id, { username: name, type: role, ...(this.password() ? { password: this.password() } : {}) }));
        if (this.auth.isMe(u)) this.auth.updateUser(update);
        this.toasts.info(`Utilisateur « ${name} » modifié`);
      }
      this.shown.set(false);
      this.saved.emit();
    } catch (err) {
      const m = errorMessage(err, 'Enregistrement impossible');
      this.toasts.error(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : 'Enregistrement impossible', m === 'Username already taken' ? null : m);
    } finally {
      this.saving.set(false);
    }
  }

  /** The groups and accesses chosen in the form, for the account just created. */
  private async setUp(id: number, role: UserRole): Promise<string[]> {
    const done: string[] = [];
    const ids = this.groups();
    for (const g of this.access.groups().filter((x) => ids.has(x.id))) {
      const req = GroupService.query(g);
      req.members = [...new Set([...req.members, id])];
      try {
        await firstValueFrom(this.groupsApi.edit(g.id, req));
      } catch (e) {
        this.toasts.error(`Ajout à « ${g.name} » impossible`, errorMessage(e));
      }
    }
    if (ids.size) done.push(`dans ${ids.size} groupe(s)`);
    if (role !== 'ADMIN') {
      const elements = this.restricted() ? (this.accessTree()?.kept() ?? []) : [];
      if (!this.restricted() || elements.length) {
        try {
          await firstValueFrom(this.users.setAccess(id, this.restricted(), elements));
          done.push(this.restricted() ? `accès à ${elements.length} élément(s)` : 'accès à tout');
        } catch (e) {
          this.toasts.error('Accès non enregistrés', errorMessage(e));
        }
      }
    }
    return done;
  }

  protected async removeShown(): Promise<void> {
    const u = this.user();
    if (u && (await this.remove(u))) this.shown.set(false);
  }

  /** Deletes [u] after a confirmation; true when done. */
  async remove(u: User): Promise<boolean> {
    if (this.auth.isMe(u)) {
      this.toasts.error('Supprime ton propre compte depuis la page Profil');
      return false;
    }
    if (!(await this.confirm.ask('Supprimer', `Supprimer l'utilisateur « ${u.username} » ?`, { confirm: 'Supprimer' }))) return false;
    try {
      await firstValueFrom(this.users.remove(u.id!));
      this.toasts.info(`Utilisateur « ${u.username} » supprimé`);
      this.saved.emit();
      return true;
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
      return false;
    }
  }
}
