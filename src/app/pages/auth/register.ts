import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ServerService, readableAddress, errorMessage, toBase } from '../../core/api.config';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { UserService } from '../../services/user.service';
import { TbPassword } from '../../ui/controls';

/** Bytes of a password in UTF-8: BCrypt only uses the first 72 (accented characters count double). */
export function bytes(s: string): number {
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

/**
 * Inscription (register.xhtml): a self-registered account is always a VIEWER. On the server of the
 * app, or another one (the mobile app on first launch, or « Autre serveur »).
 */
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
  protected readonly server = inject(ServerService);
  protected readonly platform = inject(PlatformService);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly address = signal(this.server.input() ? readableAddress(this.server.base()) : '');
  protected readonly changeServer = signal(false);
  protected readonly serverField = computed(() => this.server.unknown() || this.changeServer());

  protected readonly nameError = computed(() => {
    const n = this.username().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    if (/\s/.test(n)) return "Le nom d'utilisateur ne peut pas contenir d'espace";
    return null;
  });
  protected readonly passwordError = computed(() => {
    const p = this.password();
    if (!p) return 'Mot de passe obligatoire';
    if (p.length < 8) return 'Au moins 8 caractères';
    if (bytes(p) > 72) return 'Trop long (72 octets au plus, les lettres accentuées comptent double)';
    return null;
  });
  protected readonly confirmError = computed(() => {
    if (!this.confirm()) return 'Confirmation obligatoire';
    return this.confirm() !== this.password() ? 'Les mots de passe ne correspondent pas' : null;
  });
  protected readonly force = computed(() => force(this.password()));

  protected async create(e: Event): Promise<void> {
    e.preventDefault();
    this.sent.set(true);
    this.error.set(null);
    const base = this.serverField() ? (toBase(this.address()) ?? this.server.defaultBase) : this.server.base();
    if (!base) {
      this.error.set("Indique l'adresse du serveur ThermoBox");
      return;
    }
    if (this.nameError() || this.passwordError() || this.confirmError()) return;
    this.inProgress.set(true);
    try {
      const username = this.username().trim();
      await firstValueFrom(this.users.add({ username, password: this.password() }, base));
      // The login page, ready for the new account: its server and its name
      await this.router.navigate(['/login'], { queryParams: { registered: 'true', name: username, server: base } });
    } catch (err) {
      const m = errorMessage(err, 'Inscription impossible');
      this.error.set(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : m);
    } finally {
      this.inProgress.set(false);
    }
  }

}
