import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { UserService } from '../../services/user.service';
import { TbPassword } from '../../ui/controls';
import { bytes } from '../auth/register';

/** Mon profil (profil.xhtml): one's own name and password, or deleting one's account. */
@Component({
  selector: 'tb-profile',
  imports: [TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-narrow">
      <header class="tb-page-head">
        <span class="tb-avatar tb-avatar-xl">{{ auth.initial() }}</span>
        <div class="tb-page-title">
          <span class="tb-eyebrow">{{ auth.role() }}</span>
          <h1>Mon profil</h1>
        </div>
      </header>

      <section class="tb-panel">
        <form (submit)="save($event)" novalidate>
          <div class="tb-field">
            <label class="tb-label" for="username">Nom d'utilisateur</label>
            <input id="username" class="tb-input" autocomplete="username" autocapitalize="off" spellcheck="false" [value]="name()" (input)="name.set($any($event.target).value)"
                   [class.tb-invalid]="sent() && nameError()" />
            @if (sent() && nameError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          <div class="tb-field">
            <span class="tb-muted">Rôle : <strong>{{ auth.role() }}</strong></span>
          </div>
          <div class="tb-field">
            <label class="tb-label" for="pwd">Nouveau mot de passe (laisser vide pour ne pas changer)</label>
            <tb-password inputId="pwd" [(value)]="password" autocomplete="new-password" [invalid]="!!(sent() && passwordError())" />
            @if (sent() && passwordError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          <div class="tb-field">
            <label class="tb-label" for="confirm">Confirmation</label>
            <tb-password inputId="confirm" [(value)]="confirmation" autocomplete="new-password" />
          </div>
          <div class="tb-actions">
            <button type="submit" class="tb-btn" [class.tb-busy]="inProgress()" [disabled]="inProgress()"><i class="pi pi-check"></i>Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="tb-panel tb-danger">
        <h2 class="tb-panel-title">Zone de danger</h2>
        <p class="tb-muted">La suppression de ton compte est définitive.</p>
        <button type="button" class="tb-btn tb-btn-danger" (click)="remove()"><i class="pi pi-trash"></i>Supprimer mon compte</button>
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

  protected readonly name = signal(this.auth.user()?.username ?? '');
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);

  protected readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    return null;
  });
  protected readonly passwordError = computed(() => {
    const p = this.password();
    if (!p) return null;
    if (p.length < 8) return 'Au moins 8 caractères';
    if (bytes(p) > 72) return 'Trop long (72 octets au plus)';
    return null;
  });

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.sent.set(true);
    if (this.nameError() || this.passwordError()) return;
    if (this.password() && this.password() !== this.confirmation()) {
      this.toasts.error('Les mots de passe ne correspondent pas');
      return;
    }
    const id = this.auth.user()?.id;
    if (id == null) return;
    this.inProgress.set(true);
    try {
      const update = await firstValueFrom(this.users.update(id, { username: this.name().trim(), ...(this.password() ? { password: this.password() } : {}) }));
      this.auth.updateUser(update);
      this.password.set('');
      this.confirmation.set('');
      this.sent.set(false);
      this.toasts.info('Profil mis à jour');
    } catch (err) {
      const m = errorMessage(err, 'Mise à jour impossible');
      this.toasts.error(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : 'Mise à jour impossible', m === 'Username already taken' ? null : m);
    } finally {
      this.inProgress.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (!(await this.confirm.ask('Supprimer mon compte', 'Es-tu sûr ? Cette action est irréversible.', { confirm: 'Supprimer' }))) return;
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
