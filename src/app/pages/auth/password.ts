import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { errorMessage, readableAddress } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { PasswordPolicy } from '../../models/models';
import { TbPassword } from '../../ui/controls';
import { TbServerLogo } from '../../ui/server-logo';
import { bytes } from './register';

/** The rules when the server does not say them (they are those of ThermoBox 26.12). */
const DEFAULT_POLICY: PasswordPolicy = { minLength: 10, maxBytes: 72, letter: true, digit: true, notUsername: true };

/**
 * The first login with a provisional password (imported account, reset by an admin): the user
 * chooses their own before anything else (the server refuses the rest until then). The
 * provisional password typed at login is not asked again; the rules are ticked as they are met.
 */
@Component({
  selector: 'tb-password-page',
  imports: [TbPassword, TbServerLogo, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './password.html',
})
export class PasswordPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** The provisional password, if it was just typed at login (else asked). */
  private readonly known = this.auth.takePendingPassword();
  protected readonly askCurrent = this.known == null;
  protected readonly current = signal('');
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly sent = signal(false);
  protected readonly inProgress = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly policy = signal<PasswordPolicy>(DEFAULT_POLICY);
  protected readonly address = computed(() => readableAddress(this.auth.account()?.server));
  protected readonly expires = computed(() => {
    const at = this.auth.user()?.provisionalExpiresAt;
    return at ? new Date(at) : null;
  });

  /** Each rule and whether the new password meets it. */
  protected readonly rules = computed(() => {
    const p = this.password();
    const policy = this.policy();
    const name = (this.auth.user()?.username ?? '').toLowerCase();
    return [
      { ok: p.length >= policy.minLength, text: $localize`Au moins ${policy.minLength} caractères` },
      { ok: /\p{L}/u.test(p) && /\d/.test(p), text: $localize`Des lettres et des chiffres` },
      { ok: p.length > 0 && (name.length < 3 || !p.toLowerCase().includes(name)), text: $localize`Pas ton nom d'utilisateur` },
      { ok: p.length > 0 && p !== (this.known ?? this.current()), text: $localize`Pas le mot de passe provisoire` },
      { ok: bytes(p) <= policy.maxBytes, text: $localize`${policy.maxBytes} octets au plus` },
    ];
  });
  protected readonly valid = computed(() => this.rules().every((r) => r.ok));
  protected readonly mismatch = computed(() => this.confirmation() !== this.password());

  constructor() {
    void this.auth.passwordPolicy().then((p) => p && this.policy.set(p));
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.sent.set(true);
    this.error.set(null);
    const current = this.known ?? this.current();
    if (!current || !this.valid() || this.mismatch()) return;
    this.inProgress.set(true);
    try {
      await this.auth.changePassword(current, this.password());
      await this.router.navigateByUrl('/app/overview');
    } catch (err) {
      const body = err instanceof HttpErrorResponse ? (err.error as { code?: string; problems?: string[] } | null) : null;
      this.error.set(
        body?.code === 'wrong_password'
          ? $localize`Le mot de passe provisoire est incorrect`
          : body?.code === 'password_refused'
            ? $localize`Le serveur refuse ce mot de passe : ${(body.problems ?? []).map(problem).join(', ')}`
            : errorMessage(err, $localize`Changement impossible`),
      );
    } finally {
      this.inProgress.set(false);
    }
  }

  protected logOut(): void {
    void this.auth.logout();
  }
}

/** A code of the server (PasswordPolicy), in words. */
function problem(code: string): string {
  return (
    {
      too_short: $localize`trop court`,
      too_long: $localize`trop long`,
      no_letter: $localize`sans lettre`,
      no_digit: $localize`sans chiffre`,
      spaces_around: $localize`espaces au début ou à la fin`,
      contains_username: $localize`contient le nom d'utilisateur`,
      too_simple: $localize`trop simple`,
      same_as_current: $localize`identique au mot de passe provisoire`,
    } as Record<string, string>
  )[code] ?? code;
}
