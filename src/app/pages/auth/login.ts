import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ServeurService, messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { PlateformeService } from '../../core/plateforme';
import { PreferencesService } from '../../core/preferences';
import { TbPassword } from '../../ui/controles';

/** Connexion (login.xhtml). In the mobile app, also the address of the ThermoBox server. */
@Component({
  selector: 'tb-login',
  imports: [RouterLink, TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly serveur = inject(ServeurService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly plateforme = inject(PlateformeService);

  // Query parameters (withComponentInputBinding)
  readonly compteSupprime = input<string>();
  readonly session = input<string>();
  readonly inscrit = input<string>();

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly adresse = signal(this.serveur.saisie());
  protected readonly changerServeur = signal(false);
  protected readonly envoye = signal(false);
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);

  /** The address field: needed in the mobile app on first launch, offered elsewhere. */
  protected readonly champServeur = computed(() => this.serveur.inconnu() || this.changerServeur());

  protected async connecter(e: Event): Promise<void> {
    e.preventDefault();
    this.envoye.set(true);
    this.erreur.set(null);
    if (this.champServeur()) {
      if (!this.adresse().trim() && !this.serveur.base()) {
        this.erreur.set("Indique l'adresse du serveur ThermoBox");
        return;
      }
      this.serveur.definir(this.adresse());
    }
    if (!this.username().trim() || !this.password()) return;
    this.enCours.set(true);
    try {
      await this.auth.login(this.username().trim(), this.password());
      this.password.set('');
      await this.router.navigateByUrl('/app/apercu');
    } catch (err) {
      this.password.set('');
      const m = messageErreur(err, 'Connexion impossible');
      this.erreur.set(
        m === 'Invalid username or password'
          ? "Nom d'utilisateur ou mot de passe incorrect"
          : m.startsWith('Too many attempts')
            ? 'Trop de tentatives : réessaie dans quelques minutes'
            : m,
      );
    } finally {
      this.enCours.set(false);
    }
  }

  protected basculerTheme(e: Event): void {
    this.prefs.basculerTheme(e.currentTarget as HTMLElement);
  }
}
