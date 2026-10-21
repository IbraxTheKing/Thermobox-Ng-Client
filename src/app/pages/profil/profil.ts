import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { UserService } from '../../services/user.service';
import { TbPassword } from '../../ui/controles';
import { octets } from '../auth/register';

/** Mon profil (profil.xhtml): one's own name and password, or deleting one's account. */
@Component({
  selector: 'tb-profil',
  imports: [TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-narrow">
      <header class="tb-page-head">
        <span class="tb-avatar tb-avatar-xl">{{ auth.initiale() }}</span>
        <div class="tb-page-title">
          <span class="tb-eyebrow">{{ auth.role() }}</span>
          <h1>Mon profil</h1>
        </div>
      </header>

      <section class="tb-panel">
        <form (submit)="enregistrer($event)" novalidate>
          <div class="tb-field">
            <label class="tb-label" for="username">Nom d'utilisateur</label>
            <input id="username" class="tb-input" autocomplete="username" autocapitalize="off" spellcheck="false" [value]="nom()" (input)="nom.set($any($event.target).value)"
                   [class.tb-invalid]="envoye() && erreurNom()" />
            @if (envoye() && erreurNom(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          <div class="tb-field">
            <span class="tb-muted">Rôle : <strong>{{ auth.role() }}</strong></span>
          </div>
          <div class="tb-field">
            <label class="tb-label" for="pwd">Nouveau mot de passe (laisser vide pour ne pas changer)</label>
            <tb-password inputId="pwd" [(valeur)]="mdp" autocomplete="new-password" [invalide]="!!(envoye() && erreurMdp())" />
            @if (envoye() && erreurMdp(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          </div>
          <div class="tb-field">
            <label class="tb-label" for="confirm">Confirmation</label>
            <tb-password inputId="confirm" [(valeur)]="confirmation" autocomplete="new-password" />
          </div>
          <div class="tb-actions">
            <button type="submit" class="tb-btn" [class.tb-busy]="enCours()" [disabled]="enCours()"><i class="pi pi-check"></i>Enregistrer</button>
          </div>
        </form>
      </section>

      <section class="tb-panel tb-danger">
        <h2 class="tb-panel-title">Zone de danger</h2>
        <p class="tb-muted">La suppression de ton compte est définitive.</p>
        <button type="button" class="tb-btn tb-btn-danger" (click)="supprimer()"><i class="pi pi-trash"></i>Supprimer mon compte</button>
      </section>
    </div>
  `,
})
export class ProfilPage {
  protected readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  protected readonly nom = signal(this.auth.user()?.username ?? '');
  protected readonly mdp = signal('');
  protected readonly confirmation = signal('');
  protected readonly envoye = signal(false);
  protected readonly enCours = signal(false);

  protected readonly erreurNom = computed(() => {
    const n = this.nom().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    return null;
  });
  protected readonly erreurMdp = computed(() => {
    const p = this.mdp();
    if (!p) return null;
    if (p.length < 8) return 'Au moins 8 caractères';
    if (octets(p) > 72) return 'Trop long (72 octets au plus)';
    return null;
  });

  protected async enregistrer(e: Event): Promise<void> {
    e.preventDefault();
    this.envoye.set(true);
    if (this.erreurNom() || this.erreurMdp()) return;
    if (this.mdp() && this.mdp() !== this.confirmation()) {
      this.toasts.error('Les mots de passe ne correspondent pas');
      return;
    }
    const id = this.auth.user()?.id;
    if (id == null) return;
    this.enCours.set(true);
    try {
      const maj = await firstValueFrom(this.users.update(id, { username: this.nom().trim(), ...(this.mdp() ? { password: this.mdp() } : {}) }));
      this.auth.majUtilisateur(maj);
      this.mdp.set('');
      this.confirmation.set('');
      this.envoye.set(false);
      this.toasts.info('Profil mis à jour');
    } catch (err) {
      const m = messageErreur(err, 'Mise à jour impossible');
      this.toasts.error(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : 'Mise à jour impossible', m === 'Username already taken' ? null : m);
    } finally {
      this.enCours.set(false);
    }
  }

  protected async supprimer(): Promise<void> {
    if (!(await this.confirm.demander('Supprimer mon compte', 'Es-tu sûr ? Cette action est irréversible.', { confirmer: 'Supprimer' }))) return;
    const id = this.auth.user()?.id;
    if (id == null) return;
    try {
      await firstValueFrom(this.users.remove(id));
      this.auth.oublier();
      await this.router.navigate(['/login'], { queryParams: { compteSupprime: 'true' } });
    } catch (e) {
      this.toasts.error('Suppression impossible', messageErreur(e));
    }
  }
}
