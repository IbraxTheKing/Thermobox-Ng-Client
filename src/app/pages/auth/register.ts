import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { PreferencesService } from '../../core/preferences';
import { UserService } from '../../services/user.service';
import { TbPassword } from '../../ui/controles';

/** Bytes of a password in UTF-8: BCrypt only uses the first 72 (accented characters count double). */
export function octets(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Strength of a new password (p:password feedback): 0 faible, 1 moyen, 2 fort. */
export function force(s: string): 0 | 1 | 2 {
  let points = 0;
  if (s.length >= 8) points++;
  if (s.length >= 12) points++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) points++;
  if (/\d/.test(s)) points++;
  if (/[^A-Za-z0-9]/.test(s)) points++;
  return points >= 4 ? 2 : points >= 2 ? 1 : 0;
}

/** Inscription (register.xhtml): a self-registered account is always a VIEWER. */
@Component({
  selector: 'tb-register',
  imports: [RouterLink, TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.html',
})
export class RegisterPage {
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  protected readonly prefs = inject(PreferencesService);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly envoye = signal(false);
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);

  protected readonly erreurNom = computed(() => {
    const n = this.username().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    if (/\s/.test(n)) return "Le nom d'utilisateur ne peut pas contenir d'espace";
    return null;
  });
  protected readonly erreurMdp = computed(() => {
    const p = this.password();
    if (!p) return 'Mot de passe obligatoire';
    if (p.length < 8) return 'Au moins 8 caractères';
    if (octets(p) > 72) return 'Trop long (72 octets au plus, les lettres accentuées comptent double)';
    return null;
  });
  protected readonly erreurConfirm = computed(() => {
    if (!this.confirm()) return 'Confirmation obligatoire';
    return this.confirm() !== this.password() ? 'Les mots de passe ne correspondent pas' : null;
  });
  protected readonly force = computed(() => force(this.password()));

  protected async creer(e: Event): Promise<void> {
    e.preventDefault();
    this.envoye.set(true);
    this.erreur.set(null);
    if (this.erreurNom() || this.erreurMdp() || this.erreurConfirm()) return;
    this.enCours.set(true);
    try {
      await firstValueFrom(this.users.add({ username: this.username().trim(), password: this.password() }));
      await this.router.navigate(['/login'], { queryParams: { inscrit: 'true' } });
    } catch (err) {
      const m = messageErreur(err, 'Inscription impossible');
      this.erreur.set(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : m);
    } finally {
      this.enCours.set(false);
    }
  }

}
