import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { AvisMajService } from '../../core/avis-maj';
import { DESTINATIONS_BARRE, destinationsDe } from '../../shell/destinations';

/**
 * Last tab of the phone bar (« Plus », or « Compte » when every page fits in the bar): the pages
 * that don't fit, the account, the preferences and the logout, as the « More » page of native apps.
 */
@Component({
  selector: 'tb-plus',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-narrow">
      <header class="tb-page-head">
        <div class="tb-page-title">
          <h1>{{ autres().length ? 'Plus' : 'Compte' }}</h1>
        </div>
      </header>

      <a routerLink="/app/profil" class="tb-liste-groupe tb-plus-moi">
        <span class="tb-avatar tb-avatar-lg">{{ auth.initiale() }}</span>
        <span class="tb-liste-texte">
          <strong>{{ auth.user()?.username }}</strong>
          <span class="tb-muted">{{ role() }} · Mon profil</span>
        </span>
        <i class="pi pi-angle-right tb-liste-suite"></i>
      </a>

      @if (autres().length) {
        <nav class="tb-liste-groupe" aria-label="Autres pages">
          @for (d of autres(); track d.lien) {
            <a class="tb-liste-ligne" [routerLink]="d.lien">
              <span class="tb-liste-icone"><i class="pi" [class]="d.icone"></i></span>
              <span class="tb-liste-texte"><strong>{{ d.label }}</strong></span>
              @if (d.badge && avis.disponible()) {
                <span class="tb-tag tb-tag-danger">Nouvelle version</span>
              }
              <i class="pi pi-angle-right tb-liste-suite"></i>
            </a>
          }
        </nav>
      }

      <nav class="tb-liste-groupe" aria-label="Compte">
        <a class="tb-liste-ligne" routerLink="/app/preferences">
          <span class="tb-liste-icone"><i class="pi pi-sliders-v"></i></span>
          <span class="tb-liste-texte"><strong>Préférences</strong><span class="tb-muted">Thème, unité, couleurs</span></span>
          <i class="pi pi-angle-right tb-liste-suite"></i>
        </a>
      </nav>

      <nav class="tb-liste-groupe" aria-label="Thermobox">
        <a class="tb-liste-ligne" routerLink="/app/a-propos">
          <span class="tb-liste-icone"><i class="pi pi-info-circle"></i></span>
          <span class="tb-liste-texte"><strong>À propos</strong><span class="tb-muted">Versions, code source, crédits</span></span>
          <i class="pi pi-angle-right tb-liste-suite"></i>
        </a>
      </nav>

      <div class="tb-liste-groupe">
        <button type="button" class="tb-liste-ligne tb-liste-danger" (click)="auth.logout()">
          <span class="tb-liste-icone"><i class="pi pi-sign-out"></i></span>
          <span class="tb-liste-texte"><strong>Déconnexion</strong></span>
        </button>
      </div>
    </div>
  `,
})
export class PlusPage {
  protected readonly auth = inject(AuthService);
  protected readonly avis = inject(AvisMajService);

  protected readonly autres = computed(() => destinationsDe(this.auth).slice(DESTINATIONS_BARRE));
  protected readonly role = computed(() => ({ ADMIN: 'Administrateur', GESTIONNAIRE: 'Gestionnaire', VIEWER: 'Lecteur' })[this.auth.user()?.type ?? 'VIEWER'] ?? '');
}
