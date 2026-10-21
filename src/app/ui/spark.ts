import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Sparkline } from '../core/courbes';

/** Last 24 h of a dashboard card: average of the boxes; dashed line = consigne. */
@Component({
  selector: 'tb-spark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @if (enAttente()) {
      <div class="tb-spark-loading" aria-busy="true" aria-label="Courbe des dernières 24 h en cours de chargement">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M0 26 C 12 18, 22 30, 34 22 S 56 10, 68 20 S 88 30, 100 16" />
        </svg>
        <span class="tb-spark-caption">24 h</span>
      </div>
    } @else if (donnees(); as s) {
      <div class="tb-spark" [class.tb-spark-new]="nouvelle()">
        <svg class="tb-spark-fill" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path [attr.d]="s.aire" />
        </svg>
        <svg class="tb-spark-stroke" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path [attr.d]="s.ligne" />
        </svg>
        @if (s.consigneY != null) {
          <span class="tb-spark-consigne" [style.top.%]="s.consigneY"></span>
        }
        <span class="tb-spark-dot" [style.left.%]="s.dernierX" [style.top.%]="s.dernierY"></span>
        <span class="tb-spark-caption">24 h</span>
      </div>
    } @else {
      <div class="tb-spark tb-spark-empty" [class.tb-spark-new]="nouvelle()">Pas encore assez de mesures pour une courbe</div>
    }
  `,
})
export class TbSpark {
  readonly donnees = input<Sparkline | null>(null);
  readonly enAttente = input(false);
  /** The curves just arrived: they draw themselves once. */
  readonly nouvelle = input(false);
}
