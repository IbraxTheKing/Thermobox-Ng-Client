import { DesktopService } from '../../core/desktop';
import { VERSION_CLIENT } from '../../core/version';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';

import { ServerService, readableAddress, errorMessage, toBase } from '../../core/api.config';
import { ApiVersionService } from '../../core/api-version';
import { AuthService, Account, openable, byServer } from '../../core/auth';
import { TbServerLogo } from '../../ui/server-logo';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { initial } from '../../core/text';
import { TbPassword } from '../../ui/controls';
import { TrPipe } from '../../ui/tr.pipe';

/**
 * Connexion (login.xhtml), and the accounts saved on this device: tap one to open it, or to give
 * its password again. In the mobile app, also the address of the ThermoBox server.
 *
 * ?add: adds an account (the current one stays saved). ?account=<key>: logs in again to a saved
 * account. ?server=&name=: after registering, the new account's server and name.
 */
@Component({
  selector: 'tb-login',
  imports: [TrPipe, RouterLink, TbPassword, TbServerLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  protected readonly versions = inject(ApiVersionService);
  private readonly router = inject(Router);
  protected readonly server = inject(ServerService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly platform = inject(PlatformService);
  protected readonly desktop = inject(DesktopService);
  /** Version of this client (desktop app, foot of the page). */
  protected readonly version = VERSION_CLIENT;

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
        })),
  );

  /** The saved accounts in one section per server, its logo next to its address. */
  protected readonly servers = computed(() => byServer(this.accounts(), (b) => this.versions.name(b)));

  /** The server of this site (the address field hidden): its name, when an ADMIN gave it one. */
  protected readonly thisServerName = computed(() => this.versions.name(this.server.base()));

  /**
   * The server at the address typed, once it answered: its logo and its name (or its address
   * when it has none), so one sees the right server is reached before logging in. Asked a moment
   * after the typing stops.
   */
  protected readonly typedServer = signal<{ base: string; label: string } | null>(null);
  private lookup?: ReturnType<typeof setTimeout>;
  private readonly lookUpTyped = effect(() => {
    const typed = this.address().trim();
    untracked(() => {
      clearTimeout(this.lookup);
      this.typedServer.set(null);
      const base = typed ? toBase(typed) : null;
      if (!base || !/[.:]|localhost/i.test(typed)) return;
      this.lookup = setTimeout(async () => {
        const api = await this.versions.api(base);
        if (this.address().trim() !== typed || !api.info) return;
        this.typedServer.set({ base, label: api.info.displayName?.trim() || readableAddress(base) });
      }, 700);
    });
  });

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
        this.error.set($localize`Indique l'adresse du serveur ThermoBox`);
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
      // A provisional password: the user chooses theirs first (in this page, not a reload)
      if (this.auth.mustChangePassword()) await this.router.navigateByUrl('/password');
      else if (other) location.assign(new URL('app/apercu', document.baseURI).href);
      else await this.router.navigateByUrl('/app/overview');
    } catch (err) {
      this.password.set('');
      const m = errorMessage(err, $localize`Connexion impossible`);
      const code = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null)?.code : undefined;
      this.error.set(
        code === 'provisional_expired'
          ? $localize`Ton mot de passe provisoire a expiré : demande-en un nouveau à un administrateur.`
          : m === 'Invalid username or password'
            ? $localize`Nom d'utilisateur ou mot de passe incorrect`
            : m.startsWith('Too many attempts')
              ? $localize`Trop de tentatives : réessaie dans quelques minutes`
              : m,
      );
    } finally {
      this.inProgress.set(false);
    }
  }
}
