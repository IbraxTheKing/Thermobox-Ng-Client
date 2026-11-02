import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { UserService } from '../../services/user.service';
import { ServerFeaturesService } from '../../services/server-features.service';
import { TbPassword } from '../../ui/controls';
import { bytes } from '../auth/register';

/**
 * Mon profil (profil.xhtml): one's own username, first and last name and address (servers 26.12
 * and later), password, or deleting one's account.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;
@Component({
  selector: 'tb-profile',
  imports: [TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-narrow">
      <header class="tb-page-head">
        <span class="tb-avatar tb-avatar-xl">{{ auth.initial() }}</span>
        <div class="tb-page-title">
          <span class="tb-eyebrow">{{ roleName() }}</span>
          <h1 i18n>Mon profil</h1>
        </div>
      </header>

      <section class="tb-panel">
        <form (submit)="save($event)" novalidate>
          <div class="tb-field">
            <label i18n class="tb-label" for="username">Nom d'utilisateur</label>
            <input id="username" class="tb-input" autocomplete="username" autocapitalize="off" spellcheck="false" [value]="name()" (input)="name.set($any($event.target).value)"
                   [class.tb-invalid]="sent() && nameError()" />
            @if (sent() && nameError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          @if (features.people()) {
            <div class="tb-field-row">
              <div class="tb-field">
                <label i18n class="tb-label" for="first-name">Prénom</label>
                <input id="first-name" class="tb-input" autocomplete="given-name" maxlength="100" [value]="firstName()" (input)="firstName.set($any($event.target).value)" />
              </div>
              <div class="tb-field">
                <label i18n class="tb-label" for="last-name">Nom</label>
                <input id="last-name" class="tb-input" autocomplete="family-name" maxlength="100" [value]="lastName()" (input)="lastName.set($any($event.target).value)" />
              </div>
            </div>
            <div class="tb-field">
              <label i18n class="tb-label" for="email">Adresse e-mail</label>
              <input id="email" class="tb-input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="255"
                     [value]="email()" (input)="email.set($any($event.target).value)" [class.tb-invalid]="sent() && emailError()" />
              @if (sent() && emailError(); as e) {
                <span class="tb-field-error">{{ e }}</span>
              }
            </div>
          }
          <div class="tb-field">
            <span i18n class="tb-muted">Rôle : <strong>{{ roleName() }}</strong></span>
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="pwd">Nouveau mot de passe (laisser vide pour ne pas changer)</label>
            <tb-password inputId="pwd" [(value)]="password" autocomplete="new-password" [invalid]="!!(sent() && passwordError())" />
            @if (sent() && passwordError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="confirm">Confirmation</label>
            <tb-password inputId="confirm" [(value)]="confirmation" autocomplete="new-password" />
          </div>
          <div class="tb-actions">
            <button i18n type="submit" class="tb-btn" [class.tb-busy]="inProgress()" [disabled]="inProgress()"><i class="pi pi-check"></i>Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="tb-panel tb-danger">
        <h2 i18n class="tb-panel-title">Zone de danger</h2>
        <p i18n class="tb-muted">La suppression de ton compte est définitive.</p>
        <button i18n type="button" class="tb-btn tb-btn-danger" (click)="remove()"><i class="pi pi-trash"></i>Supprimer mon compte</button>
      </section>
    </div>
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  protected readonly features = inject(ServerFeaturesService);

  protected readonly name = signal(this.auth.user()?.username ?? '');
  protected readonly firstName = signal(this.auth.user()?.firstName ?? '');
  protected readonly lastName = signal(this.auth.user()?.lastName ?? '');
  protected readonly email = signal(this.auth.user()?.email ?? '');
  protected readonly roleName = computed(
    () => ({ ADMIN: $localize`Administrateur`, MANAGER: $localize`Gestionnaire`, VIEWER: $localize`Lecteur` })[this.auth.role() ?? 'VIEWER'],
  );
  protected readonly emailError = computed(() => {
    const m = this.email().trim();
    return m && (m.length > 255 || !EMAIL.test(m)) ? $localize`Adresse e-mail invalide` : null;
  });
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);

  protected readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return $localize`Nom d'utilisateur obligatoire`;
    if (n.length < 3 || n.length > 50) return $localize`Entre 3 et 50 caractères`;
    return null;
  });
  protected readonly passwordError = computed(() => {
    const p = this.password();
    if (!p) return null;
    if (p.length < 8) return $localize`Au moins 8 caractères`;
    if (bytes(p) > 72) return $localize`Trop long (72 octets au plus)`;
    return null;
  });

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.sent.set(true);
    if (this.nameError() || this.passwordError() || this.emailError()) return;
    if (this.password() && this.password() !== this.confirmation()) {
      this.toasts.error('Les mots de passe ne correspondent pas');
      return;
    }
    const id = this.auth.user()?.id;
    if (id == null) return;
    this.inProgress.set(true);
    try {
      const person = this.features.people() ? { firstName: this.firstName().trim(), lastName: this.lastName().trim(), email: this.email().trim() } : {};
      const update = await firstValueFrom(this.users.update(id, { username: this.name().trim(), ...person, ...(this.password() ? { password: this.password() } : {}) }));
      this.auth.updateUser(update);
      this.password.set('');
      this.confirmation.set('');
      this.sent.set(false);
      this.toasts.info('Profil mis à jour');
    } catch (err) {
      const m = errorMessage(err, $localize`Mise à jour impossible`);
      const known: Record<string, string> = {
        'Username already taken': $localize`Ce nom d'utilisateur est déjà pris`,
        'Email address already used': $localize`Cette adresse est déjà utilisée par un autre compte`,
        'Invalid email address': $localize`Adresse e-mail invalide`,
      };
      this.toasts.error(known[m] ?? $localize`Mise à jour impossible`, known[m] ? null : m);
    } finally {
      this.inProgress.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (!(await this.confirm.ask($localize`Supprimer mon compte`, $localize`Es-tu sûr ? Cette action est irréversible.`, { confirm: $localize`Supprimer` }))) return;
    const id = this.auth.user()?.id;
    if (id == null) return;
    try {
      await firstValueFrom(this.users.remove(id));
      this.auth.forget();
      await this.router.navigate(['/login'], { queryParams: { deletedAccount: 'true' } });
    } catch (e) {
      this.toasts.error('Suppression impossible', errorMessage(e));
    }
  }
}
