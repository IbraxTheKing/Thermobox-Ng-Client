import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ConfirmService, ToastService } from '../core/messages';
import { TbSheet } from './sheet';

/** Notifications of the whole app (p:growl). */
@Component({
  selector: 'tb-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-toasts" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <!-- A tap anywhere on it closes it (phones have no × to aim at) -->
        <div class="tb-toast" [class.tb-toast-warn]="t.gravite === 'warn'" [class.tb-toast-error]="t.gravite === 'error'" role="status" (click)="toasts.fermer(t.id)">
          <i class="pi" [class.pi-info-circle]="t.gravite === 'info'" [class.pi-exclamation-triangle]="t.gravite === 'warn'" [class.pi-times-circle]="t.gravite === 'error'"></i>
          <div class="tb-toast-text">
            <strong>{{ t.titre }}</strong>
            @if (t.detail) {
              <span>{{ t.detail }}</span>
            }
          </div>
          <button type="button" class="tb-toast-fermer" (click)="toasts.fermer(t.id)" aria-label="Fermer"><i class="pi pi-times"></i></button>
        </div>
      }
    </div>
  `,
})
export class TbToasts {
  protected readonly toasts = inject(ToastService);
}

/** "Are you sure?" of the whole app (p:confirmDialog). */
@Component({
  selector: 'tb-confirm',
  imports: [TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [ouvert]="ouvert()" (ouvertChange)="!$event && confirm.repondre(false)" [titre]="c()?.titre ?? ''" [largeur]="400">
      @if (c(); as c) {
        <div class="tb-confirm">
          <i class="pi pi-exclamation-triangle"></i>
          <p>{{ c.message }}</p>
        </div>
        <div class="tb-actions">
          <button type="button" class="tb-btn tb-flat" (click)="confirm.repondre(false)">Annuler</button>
          <button type="button" class="tb-btn" [class.tb-btn-danger]="c.danger" (click)="confirm.repondre(true)">{{ c.confirmer }}</button>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbConfirm {
  protected readonly confirm = inject(ConfirmService);
  protected readonly c = this.confirm.courante;
  protected readonly ouvert = computed(() => this.c() != null);
}
