import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';

import { ApiVersionService } from '../core/api-version';

/**
 * The logo of a ThermoBox server (GET /api/v2/server/logo, since 26.12): next to its address in
 * the account lists, and as a badge on the avatar of an account. A server before 26.12 has none:
 * the server icon then (or nothing, [badge]).
 *
 *   <tb-server-logo [base]="account.server" />
 *   <span class="tb-avatar">C<tb-server-logo badge [base]="account.server" /></span>
 */
@Component({
  selector: 'tb-server-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-server-logo', '[class.tb-server-logo-badge]': 'badge()', '[class.tb-server-logo-none]': '!src()', '[attr.aria-hidden]': 'true' },
  template: `
    @if (src(); as s) {
      <img [src]="s" alt="" decoding="async" loading="lazy" (error)="failed.set(s)" />
    } @else if (!badge()) {
      <i class="pi pi-server"></i>
    }
  `,
})
export class TbServerLogo {
  private readonly versions = inject(ApiVersionService);

  /** API base of the server ("/api", "https://thermobox.example.com/api"). */
  readonly base = input.required<string>();
  /** Small, over the corner of an avatar; nothing without a logo. */
  readonly badge = input(false, { transform: (v: boolean | '') => v !== false });

  /** An image that did not load (server offline): the icon instead. */
  protected readonly failed = signal<string | null>(null);
  protected readonly src = computed(() => {
    const url = this.versions.logo(this.base(), this.badge() ? 48 : 64);
    return url && url !== this.failed() ? url : null;
  });

  constructor() {
    // Asked once per launch and per server: the logo appears when the answer comes
    effect(() => void this.versions.api(this.base()));
  }
}
