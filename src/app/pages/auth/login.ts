import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ServeurService, adresseLisible, messageErreur, versBase } from '../../core/api.config';
import { AuthService, Compte, ouvrable } from '../../core/auth';
import { PlateformeService } from '../../core/plateforme';
import { PreferencesService } from '../../core/preferences';
import { initiale } from '../../core/texte';
import { TbPassword } from '../../ui/controles';

/**
 * Connexion (login.xhtml), and the accounts saved on this device: tap one to open it, or to give
 * its password again. In the mobile app, also the address of the ThermoBox server.
 *
 * ?ajout: adds an account (the current one stays saved). ?compte=<key>: logs in again to a saved
 * account. ?serveur=&nom=: after registering, the new account's server and name.
 */
@Component({
  selector: 'tb-login',
  imports: [RouterLink, TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly serveur = inject(ServeurService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly plateforme = inject(PlateformeService);

  // Query parameters (withComponentInputBinding)
  readonly compteSupprime = input<string>();
  readonly session = input<string>();
  readonly inscrit = input<string>();
  readonly ajout = input<string>();
  readonly compte = input<string>();
  readonly nom = input<string>();
  readonly serveurInscrit = input<string>(undefined, { alias: 'serveur' });

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly adresse = signal(this.serveur.saisie() ? adresseLisible(this.serveur.base()) : '');
  protected readonly changerServeur = signal(false);
  protected readonly envoye = signal(false);
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  /** The saved account whose password is asked (server and name already known). */
  protected readonly choisi = signal<Compte | null>(null);

  /** Adding an account while logged in to another one. */
  protected readonly enAjout = computed(() => this.ajout() != null && this.auth.connecte());

  /** Saved accounts to pick from (not while one is chosen). */
  protected readonly comptes = computed(() =>
    this.choisi()
      ? []
      : this.auth.comptes().map((c) => ({
          compte: c,
          actuel: c.cle === this.auth.cle(),
          ouvrable: ouvrable(c),
          initiale: initiale(c.user.username),
          adresse: adresseLisible(c.serveur),
        })),
  );

  /** The address field: needed in the mobile app on first launch, offered elsewhere. */
  protected readonly champServeur = computed(() => !this.choisi() && (this.serveur.inconnu() || this.changerServeur() || this.enAjout()));

  protected readonly initialeChoisi = computed(() => initiale(this.choisi()?.user.username));
  protected readonly adresseChoisi = computed(() => adresseLisible(this.choisi()?.serveur));

  constructor() {
    effect(() => {
      const cle = this.compte();
      const nom = this.nom();
      const serveur = this.serveurInscrit();
      untracked(() => {
        const c = cle ? this.auth.comptes().find((x) => x.cle === cle) : undefined;
        if (c) this.choisir(c);
        if (nom) this.username.set(nom);
        if (serveur) {
          this.adresse.set(adresseLisible(serveur));
          if (serveur !== this.serveur.base()) this.changerServeur.set(true);
        }
      });
    });
  }

  /** A saved account: opened at once if it may be, else its password is asked. */
  protected ouvrirCompte(l: { compte: Compte; actuel: boolean; ouvrable: boolean }): void {
    if (l.actuel) {
      void this.router.navigateByUrl('/app/apercu');
      return;
    }
    if (l.ouvrable) {
      void this.auth.basculer(l.compte.cle);
      return;
    }
    this.choisir(l.compte);
  }

  protected choisir(c: Compte | null): void {
    this.choisi.set(c);
    this.username.set(c?.user.username ?? '');
    this.password.set('');
    this.erreur.set(null);
    this.envoye.set(false);
    if (c) setTimeout(() => document.getElementById('password')?.focus(), 0);
  }

  protected async connecter(e: Event): Promise<void> {
    e.preventDefault();
    this.envoye.set(true);
    this.erreur.set(null);
    const choisi = this.choisi();
    let base = this.serveur.base();
    if (choisi) {
      base = choisi.serveur;
    } else if (this.champServeur()) {
      base = versBase(this.adresse()) ?? this.serveur.defaut;
      if (!base) {
        this.erreur.set("Indique l'adresse du serveur ThermoBox");
        return;
      }
    }
    if (!this.username().trim() || !this.password()) return;
    // Another account was open: the app starts again on the new one (nothing of the other stays)
    const autre = this.auth.connecte();
    this.enCours.set(true);
    try {
      await this.auth.login(this.username().trim(), this.password(), base);
      this.password.set('');
      if (autre) location.assign(new URL('app/apercu', document.baseURI).href);
      else await this.router.navigateByUrl('/app/apercu');
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
}
