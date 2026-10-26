import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { UpdateNoticeService } from '../../core/update-notice';
import { PlatformService } from '../../core/platform';
import { PreferencesService } from '../../core/preferences';
import { destinationsOf, barSlots } from '../../shell/destinations';
import { TbAccounts } from '../../ui/accounts';

/**
 * Last tab of the phone bar (« Plus », or « Compte » when every page fits in the bar): the pages
 * that don't fit, the account, the preferences and the logout, as the « More » page of native apps.
 */
@Component({
  selector: 'tb-more',
  imports: [RouterLink, TbAccounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-narrow">
      <header class="tb-page-head">
        <div class="tb-page-title">
          <h1>{{ home() ? 'Réglages' : others().length ? 'Plus' : 'Compte' }}</h1>
        </div>
      </header>

      <a routerLink="/app/profile" class="tb-list-group tb-more-me">
        <span class="tb-avatar tb-avatar-lg">{{ auth.initial() }}</span>
        <span class="tb-list-text">
          <strong>{{ auth.user()?.username }}</strong>
          <span class="tb-muted">{{ role() }} · Mon profil</span>
          <span class="tb-account-address"><i class="pi pi-server" aria-hidden="true"></i>{{ auth.address() }}</span>
        </span>
        <i class="pi pi-angle-right tb-list-continuation"></i>
      </a>

      <div class="tb-list-group">
        <button type="button" class="tb-list-row" (click)="accounts.set(true)">
          <span class="tb-list-icon"><i class="pi pi-users"></i></span>
          <span class="tb-list-text">
            <strong>Changer de compte</strong>
            <span class="tb-muted">{{ otherAccounts() ? otherAccounts() + ' autre' + (otherAccounts() > 1 ? 's' : '') + ' sur cet appareil' : 'Ajouter un compte, sur ce serveur ou un autre' }}</span>
          </span>
          <i class="pi pi-angle-right tb-list-continuation"></i>
        </button>
      </div>
      <tb-accounts [(open)]="accounts" />

      @if (others().length) {
        <nav class="tb-list-group" aria-label="Autres pages">
          @for (d of others(); track d.link) {
            <a class="tb-list-row" [routerLink]="d.link">
              <span class="tb-list-icon"><i class="pi" [class]="d.icon"></i></span>
              <span class="tb-list-text"><strong>{{ d.label }}</strong></span>
              @if (d.badge && notice.available()) {
                <span class="tb-tag tb-tag-danger">Nouvelle version</span>
              }
              <i class="pi pi-angle-right tb-list-continuation"></i>
            </a>
          }
        </nav>
      }

      <nav class="tb-list-group" aria-label="Compte">
        <a class="tb-list-row" routerLink="/app/preferences">
          <span class="tb-list-icon"><i class="pi pi-sliders-v"></i></span>
          <span class="tb-list-text"><strong>Préférences</strong><span class="tb-muted">Thème, unité, couleurs</span></span>
          <i class="pi pi-angle-right tb-list-continuation"></i>
        </a>
      </nav>

      <nav class="tb-list-group" aria-label="Thermobox">
        <a class="tb-list-row" routerLink="/app/about">
          <span class="tb-list-icon"><i class="pi pi-info-circle"></i></span>
          <span class="tb-list-text"><strong>À propos</strong><span class="tb-muted">Versions, code source, crédits</span></span>
          <i class="pi pi-angle-right tb-list-continuation"></i>
        </a>
      </nav>

      <div class="tb-list-group">
        <button type="button" class="tb-list-row tb-list-danger" (click)="auth.logout()">
          <span class="tb-list-icon"><i class="pi pi-sign-out"></i></span>
          <span class="tb-list-text"><strong>Déconnexion</strong></span>
        </button>
      </div>
    </div>
  `,
})
export class MorePage {
  protected readonly auth = inject(AuthService);
  protected readonly notice = inject(UpdateNoticeService);

  protected readonly accounts = signal(false);
  protected readonly otherAccounts = computed(() => this.auth.accounts().length - 1);
  private readonly prefs = inject(PreferencesService);
  private readonly platform = inject(PlatformService);
  protected readonly home = computed(() => this.prefs.style() !== 'panel');
  /** The pages that are not in the bar; beside a rail (tablet, phone sideways), every page is in it. */
  protected readonly others = computed(() => (this.platform.bottomBar() ? destinationsOf(this.auth, this.home()).slice(barSlots(this.home())) : []));
  protected readonly role = computed(() => ({ ADMIN: 'Administrateur', MANAGER: 'Gestionnaire', VIEWER: 'Lecteur' })[this.auth.user()?.type ?? 'VIEWER'] ?? '');
}
