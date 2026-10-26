import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, computed, effect, inject, input, model } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { readableAddress } from '../core/api.config';
import { AuthService, Account, openable } from '../core/auth';
import { ConfirmService } from '../core/messages';
import { initial } from '../core/text';
import { TbSheet } from './sheet';

/**
 * « Changer de compte »: the accounts saved on this device (one per server and user), each with
 * the address of its server under its name. Tap one to open it (its password is asked again if
 * it was logged out or has expired); « Ajouter un compte » logs in to another one, the current
 * account stays saved.
 *
 * Two forms: a sheet (phones, the Plus page) and, on a computer, a menu that drops from the
 * account at the foot of the side bar (mode="menu"; closed by a click elsewhere or Escape).
 *
 *   <tb-accounts [(ouvert)]="comptes" />
 *   <tb-accounts mode="menu" [(ouvert)]="menuComptes" />
 */
@Component({
  selector: 'tb-accounts',
  imports: [TbSheet, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #list>
      <ul class="tb-accounts">
        @for (c of rows(); track c.key) {
          <li>
            <button type="button" class="tb-account" [class.tb-account-active]="c.active" [attr.aria-current]="c.active ? 'true' : null" (click)="choose(c)">
              <span class="tb-avatar" aria-hidden="true">{{ c.initial }}</span>
              <span class="tb-account-text">
                <strong>{{ c.account.user.username }}</strong>
                <span class="tb-account-address"><i class="pi pi-server" aria-hidden="true"></i>{{ c.address }}</span>
              </span>
              @if (c.active) {
                <i class="pi pi-check tb-account-check" aria-label="Compte actuel"></i>
              } @else if (!c.openable) {
                <span class="tb-tag">Mot de passe</span>
              }
            </button>
            <button type="button" class="tb-btn tb-icon tb-flat tb-account-forget" (click)="forget(c.account)"
                    [title]="'Oublier ' + c.account.user.username + ' sur cet appareil'" [attr.aria-label]="'Oublier ' + c.account.user.username">
              <i class="pi pi-times"></i>
            </button>
          </li>
        }
      </ul>
    </ng-template>

    @if (mode() === 'menu') {
      @if (open()) {
        <div class="tb-accounts-menu" role="dialog" aria-label="Comptes" animate.enter="tb-menu-enter" animate.leave="tb-menu-sort">
          <ng-container *ngTemplateOutlet="list" />
          <div class="tb-accounts-menu-foot">
            <button type="button" class="tb-sheet-item tb-account-adding" (click)="add()"><i class="pi pi-user-plus"></i>Ajouter un compte</button>
            <a routerLink="/app/profile" class="tb-sheet-item" (click)="open.set(false)"><i class="pi pi-user"></i>Mon profil</a>
          </div>
        </div>
      }
    } @else {
      <tb-sheet [(open)]="open" title="Comptes" [width]="440">
        <ng-container *ngTemplateOutlet="list" />
        <button type="button" class="tb-sheet-item tb-account-adding" (click)="add()">
          <i class="pi pi-user-plus"></i>Ajouter un compte
        </button>
      </tb-sheet>
    }
  `,
})
export class TbAccounts {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);

  readonly open = model(false);
  readonly mode = input<'feuille' | 'menu'>('feuille');

  constructor() {
    // The menu: a click outside it (and outside what opened it) or Escape closes it
    const doc = inject(DOCUMENT);
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const outside = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !host.contains(t) && !t.closest('[data-accounts-opener]')) this.open.set(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.open.set(false);
    };
    effect((onCleanup) => {
      if (this.mode() !== 'menu' || !this.open()) return;
      doc.addEventListener('pointerdown', outside, true);
      doc.addEventListener('keydown', escape);
      onCleanup(() => {
        doc.removeEventListener('pointerdown', outside, true);
        doc.removeEventListener('keydown', escape);
      });
    });
  }

  protected readonly rows = computed(() =>
    this.auth.accounts().map((account) => ({
      key: account.key,
      account,
      active: account.key === this.auth.key(),
      openable: openable(account),
      initial: initial(account.user.username),
      address: readableAddress(account.server),
    })),
  );

  protected choose(l: { account: Account; active: boolean }): void {
    this.open.set(false);
    if (!l.active) void this.auth.toggle(l.account.key);
  }

  protected async forget(c: Account): Promise<void> {
    const current = c.key === this.auth.key();
    const ok = await this.confirm.ask(
      'Oublier ce compte',
      `« ${c.user.username} » (${readableAddress(c.server)}) ne sera plus proposé sur cet appareil${current ? ' et tu seras déconnecté' : ''}. Le compte lui-même n'est pas supprimé.`,
      { confirm: 'Oublier', danger: true },
    );
    if (!ok) return;
    if (current) this.open.set(false);
    await this.auth.forgetAccount(c.key);
  }

  protected add(): void {
    this.open.set(false);
    void this.router.navigate(['/login'], { queryParams: { add: 1 } });
  }
}
