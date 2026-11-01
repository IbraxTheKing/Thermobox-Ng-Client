import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, computed, effect, inject, input, model } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { adresseLisible } from '../core/api.config';
import { AuthService, Compte, ouvrable } from '../core/auth';
import { ConfirmService } from '../core/messages';
import { initiale } from '../core/texte';
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
 *   <tb-comptes [(ouvert)]="comptes" />
 *   <tb-comptes mode="menu" [(ouvert)]="menuComptes" />
 */
@Component({
  selector: 'tb-comptes',
  imports: [TbSheet, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #liste>
      <ul class="tb-comptes">
        @for (c of lignes(); track c.cle) {
          <li>
            <button type="button" class="tb-compte" [class.tb-compte-actif]="c.actif" [attr.aria-current]="c.actif ? 'true' : null" (click)="choisir(c)">
              <span class="tb-avatar" aria-hidden="true">{{ c.initiale }}</span>
              <span class="tb-compte-texte">
                <strong>{{ c.compte.user.username }}</strong>
                <span class="tb-compte-adresse"><i class="pi pi-server" aria-hidden="true"></i>{{ c.adresse }}</span>
              </span>
              @if (c.actif) {
                <i class="pi pi-check tb-compte-coche" aria-label="Compte actuel"></i>
              } @else if (!c.ouvrable) {
                <span class="tb-tag">Mot de passe</span>
              }
            </button>
            <button type="button" class="tb-btn tb-icon tb-flat tb-compte-oublier" (click)="oublier(c.compte)"
                    [title]="'Oublier ' + c.compte.user.username + ' sur cet appareil'" [attr.aria-label]="'Oublier ' + c.compte.user.username">
              <i class="pi pi-times"></i>
            </button>
          </li>
        }
      </ul>
    </ng-template>

    @if (mode() === 'menu') {
      @if (ouvert()) {
        <div class="tb-comptes-menu" role="dialog" aria-label="Comptes" animate.enter="tb-menu-entre" animate.leave="tb-menu-sort">
          <ng-container *ngTemplateOutlet="liste" />
          <div class="tb-comptes-menu-pied">
            <button type="button" class="tb-sheet-item tb-compte-ajout" (click)="ajouter()"><i class="pi pi-user-plus"></i>Ajouter un compte</button>
            <a routerLink="/app/profil" class="tb-sheet-item" (click)="ouvert.set(false)"><i class="pi pi-user"></i>Mon profil</a>
          </div>
        </div>
      }
    } @else {
      <tb-sheet [(ouvert)]="ouvert" titre="Comptes" [largeur]="440">
        <ng-container *ngTemplateOutlet="liste" />
        <button type="button" class="tb-sheet-item tb-compte-ajout" (click)="ajouter()">
          <i class="pi pi-user-plus"></i>Ajouter un compte
        </button>
      </tb-sheet>
    }
  `,
})
export class TbComptes {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);

  readonly ouvert = model(false);
  readonly mode = input<'feuille' | 'menu'>('feuille');

  constructor() {
    // The menu: a click outside it (and outside what opened it) or Escape closes it
    const doc = inject(DOCUMENT);
    const hote = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const dehors = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !hote.contains(t) && !t.closest('[data-comptes-ouvre]')) this.ouvert.set(false);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.ouvert.set(false);
    };
    effect((onCleanup) => {
      if (this.mode() !== 'menu' || !this.ouvert()) return;
      doc.addEventListener('pointerdown', dehors, true);
      doc.addEventListener('keydown', echap);
      onCleanup(() => {
        doc.removeEventListener('pointerdown', dehors, true);
        doc.removeEventListener('keydown', echap);
      });
    });
  }

  protected readonly lignes = computed(() =>
    this.auth.comptes().map((compte) => ({
      cle: compte.cle,
      compte,
      actif: compte.cle === this.auth.cle(),
      ouvrable: ouvrable(compte),
      initiale: initiale(compte.user.username),
      adresse: adresseLisible(compte.serveur),
    })),
  );

  protected choisir(l: { compte: Compte; actif: boolean }): void {
    this.ouvert.set(false);
    if (!l.actif) void this.auth.basculer(l.compte.cle);
  }

  protected async oublier(c: Compte): Promise<void> {
    const actuel = c.cle === this.auth.cle();
    const ok = await this.confirm.demander(
      'Oublier ce compte',
      `« ${c.user.username} » (${adresseLisible(c.serveur)}) ne sera plus proposé sur cet appareil${actuel ? ' et tu seras déconnecté' : ''}. Le compte lui-même n'est pas supprimé.`,
      { confirmer: 'Oublier', danger: true },
    );
    if (!ok) return;
    if (actuel) this.ouvert.set(false);
    await this.auth.oublierCompte(c.cle);
  }

  protected ajouter(): void {
    this.ouvert.set(false);
    void this.router.navigate(['/login'], { queryParams: { ajout: 1 } });
  }
}
