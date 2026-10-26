import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Sparkline } from '../core/curves';

/** Last 24 h of a dashboard card: average of the boxes; dashed line = setpoint. */
@Component({
  selector: 'tb-spark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (pending()) {
      <div class="tb-spark-loading" aria-busy="true" aria-label="Courbe des dernières 24 h en cours de chargement">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M0 26 C 12 18, 22 30, 34 22 S 56 10, 68 20 S 88 30, 100 16" />
        </svg>
        <span class="tb-spark-caption">24 h</span>
      </div>
    } @else if (data(); as s) {
      <div class="tb-spark" [class.tb-spark-new]="fresh()">
        <svg class="tb-spark-fill" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path [attr.d]="s.area" />
        </svg>
        <svg class="tb-spark-stroke" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path [attr.d]="s.row" />
        </svg>
        @if (s.setpointY != null) {
          <span class="tb-spark-setpoint" [style.top.%]="s.setpointY"></span>
        }
        <span class="tb-spark-dot" [style.left.%]="s.lastX" [style.top.%]="s.lastY"></span>
        <span class="tb-spark-caption">24 h</span>
      </div>
    } @else {
      <div class="tb-spark tb-spark-empty" [class.tb-spark-new]="fresh()">Pas encore assez de mesures pour une courbe</div>
    }
  `,
})
export class TbSpark {
  readonly data = input<Sparkline | null>(null);
  readonly pending = input(false);
  /** The curves just arrived: they draw themselves once. */
  readonly fresh = input(false);
}
