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
        <div class="tb-toast" [class.tb-toast-warn]="t.severity === 'warn'" [class.tb-toast-error]="t.severity === 'error'" role="status" (click)="toasts.close(t.id)">
          <i class="pi" [class.pi-info-circle]="t.severity === 'info'" [class.pi-exclamation-triangle]="t.severity === 'warn'" [class.pi-times-circle]="t.severity === 'error'"></i>
          <div class="tb-toast-text">
            <strong>{{ t.title }}</strong>
            @if (t.detail) {
              <span>{{ t.detail }}</span>
            }
          </div>
          <button type="button" class="tb-toast-close" (click)="toasts.close(t.id)" aria-label="Fermer"><i class="pi pi-times"></i></button>
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
    <tb-sheet [open]="open()" (openChange)="!$event && confirm.answer(false)" [title]="c()?.title ?? ''" [width]="400">
      @if (c(); as c) {
        <div class="tb-confirm">
          <i class="pi pi-exclamation-triangle"></i>
          <p>{{ c.message }}</p>
        </div>
        <div class="tb-actions">
          <button type="button" class="tb-btn tb-flat" (click)="confirm.answer(false)">Annuler</button>
          <button type="button" class="tb-btn" [class.tb-btn-danger]="c.danger" (click)="confirm.answer(true)">{{ c.confirm }}</button>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbConfirm {
  protected readonly confirm = inject(ConfirmService);
  protected readonly c = this.confirm.current;
  protected readonly open = computed(() => this.c() != null);
}
