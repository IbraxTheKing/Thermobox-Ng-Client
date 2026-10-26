import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ServerService, readableAddress, errorMessage, toBase } from '../../core/api.config';
import { AuthService, Account, openable } from '../../core/auth';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { initial } from '../../core/text';
import { TbPassword } from '../../ui/controls';

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
  protected readonly server = inject(ServerService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly platform = inject(PlatformService);

  // Query parameters (withComponentInputBinding)
  readonly deletedAccount = input<string>();
  readonly session = input<string>();
  readonly registered = input<string>();
  readonly add = input<string>();
  readonly account = input<string>();
  readonly name = input<string>();
  readonly serverRegistered = input<string>(undefined, { alias: 'server' });

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly address = signal(this.server.input() ? readableAddress(this.server.base()) : '');
  protected readonly changeServer = signal(false);
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The saved account whose password is asked (server and name already known). */
  protected readonly chosen = signal<Account | null>(null);

  /** Adding an account while logged in to another one. */
  protected readonly adding = computed(() => this.add() != null && this.auth.loggedIn());

  /** Saved accounts to pick from (not while one is chosen). */
  protected readonly accounts = computed(() =>
    this.chosen()
      ? []
      : this.auth.accounts().map((c) => ({
          account: c,
          current: c.key === this.auth.key(),
          openable: openable(c),
          initial: initial(c.user.username),
          address: readableAddress(c.server),
        })),
  );

  /** The address field: needed in the mobile app on first launch, offered elsewhere. */
  protected readonly serverField = computed(() => !this.chosen() && (this.server.unknown() || this.changeServer() || this.adding()));

  protected readonly chosenInitial = computed(() => initial(this.chosen()?.user.username));
  protected readonly chosenAddress = computed(() => readableAddress(this.chosen()?.server));

  constructor() {
    effect(() => {
      const key = this.account();
      const name = this.name();
      const server = this.serverRegistered();
      untracked(() => {
        const c = key ? this.auth.accounts().find((x) => x.key === key) : undefined;
        if (c) this.choose(c);
        if (name) this.username.set(name);
        if (server) {
          this.address.set(readableAddress(server));
          if (server !== this.server.base()) this.changeServer.set(true);
        }
      });
    });
  }

  /** A saved account: opened at once if it may be, else its password is asked. */
  protected openAccount(l: { account: Account; current: boolean; openable: boolean }): void {
    if (l.current) {
      void this.router.navigateByUrl('/app/overview');
      return;
    }
    if (l.openable) {
      void this.auth.toggle(l.account.key);
      return;
    }
    this.choose(l.account);
  }

  protected choose(c: Account | null): void {
    this.chosen.set(c);
    this.username.set(c?.user.username ?? '');
    this.password.set('');
    this.error.set(null);
    this.sent.set(false);
    if (c) setTimeout(() => document.getElementById('password')?.focus(), 0);
  }

  protected async logIn(e: Event): Promise<void> {
    e.preventDefault();
    this.sent.set(true);
    this.error.set(null);
    const chosen = this.chosen();
    let base = this.server.base();
    if (chosen) {
      base = chosen.server;
    } else if (this.serverField()) {
      base = toBase(this.address()) ?? this.server.defaultBase;
      if (!base) {
        this.error.set("Indique l'adresse du serveur ThermoBox");
        return;
      }
    }
    if (!this.username().trim() || !this.password()) return;
    // Another account was open: the app starts again on the new one (nothing of the other stays)
    const other = this.auth.loggedIn();
    this.inProgress.set(true);
    try {
      await this.auth.login(this.username().trim(), this.password(), base);
      this.password.set('');
      if (other) location.assign(new URL('app/apercu', document.baseURI).href);
      else await this.router.navigateByUrl('/app/overview');
    } catch (err) {
      this.password.set('');
      const m = errorMessage(err, 'Connexion impossible');
      this.error.set(
        m === 'Invalid username or password'
          ? "Nom d'utilisateur ou mot de passe incorrect"
          : m.startsWith('Too many attempts')
            ? 'Trop de tentatives : réessaie dans quelques minutes'
            : m,
      );
    } finally {
      this.inProgress.set(false);
    }
  }
}
