import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { iconeVariation } from '../../core/courbes';
import { jjmmHHmm } from '../../core/dates';
import { UniteService } from '../../core/unite';
import { TbWatch } from '../../ui/controles';
import { TbPhotoImg } from '../../ui/photo';
import { TbSpark } from '../../ui/spark';
import { SalleResume } from './resume';

/** Card of a salle on the dashboard (salle-card.xhtml). */
@Component({
  selector: 'tb-salle-card',
  imports: [RouterLink, TbSpark, TbPhotoImg, TbWatch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let s = r().salle;
    <!-- data-vt: card, name, photo and temperature morph into the detail page (named only then: TransitionsService) -->
    <article
      class="tb-room tb-ton-{{ r().etat.ton }}"
      [class.tb-room-photo]="s.image != null"
      [attr.data-flip]="s.id"
      data-vt="salle-card" [attr.data-vt-id]="s.id"
      style="view-transition-class: tb-card"
    >
      <!-- Stretched over the whole card: click anywhere to open the detail -->
      <a [routerLink]="['/app/salle', s.id]" class="tb-stretched" [title]="'Voir le détail de ' + s.name">
        <span class="tb-sr-only">Voir le détail de {{ s.name }}</span>
      </a>

      @if (s.image != null) {
        <div class="tb-room-media" data-vt="salle-photo" [attr.data-vt-id]="s.id">
          <tb-photo-img [salleId]="s.id" [version]="s.image" />
        </div>
      }

      <button
        type="button"
        class="tb-btn tb-icon tb-flat tb-fav"
        [class.tb-fav-on]="s.favori"
        [title]="s.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'"
        [attr.aria-pressed]="s.favori"
        (click)="favori.emit(s.id)"
      >
        <i class="pi" [class.pi-star-fill]="s.favori" [class.pi-star]="!s.favori"></i>
      </button>

      <div class="tb-room-head">
        <h3 class="tb-room-name" data-vt="salle-nom" [attr.data-vt-id]="s.id">{{ s.name }}</h3>
        <div class="tb-room-path">{{ r().chemin || 'Non rattachée' }}</div>
      </div>

      <div class="tb-room-reading">
        <span class="tb-temp-xl" data-vt="salle-temp" [attr.data-vt-id]="s.id" [tbWatch]="s.temperature">
          {{ unite.t(s.temperature) }}<span class="tb-deg">°</span>
        </span>
        <div class="tb-room-badges">
          <span class="tb-state">{{ r().etat.label }}</span>
          @if (r().tendance?.variation != null) {
            <span class="tb-trend"><i class="pi" [class]="icone()"></i>{{ unite.ecart(r().tendance!.variation) }} en 1 h</span>
          }
        </div>
      </div>

      <!-- Last 24 h: average of the boxes; dashed line = consigne -->
      <tb-spark [donnees]="r().tendance ?? null" [enAttente]="r().tendance === undefined" [nouvelle]="nouvelles()" />

      <div class="tb-room-foot">
        <span class="tb-consigne-pill" [title]="titreConsigne()">
          <i class="pi" [class.pi-sitemap]="s.consigne?.heritee" [class.pi-sliders-h]="!s.consigne?.heritee"></i>
          {{ unite.t(s.consigne?.value) }} {{ unite.symbole() }}
          <b>{{ unite.ecart(r().ecart) }}</b>
        </span>
        <span class="tb-room-meta">
          @if (auth.voitBoitiers()) {
            <i class="pi pi-wifi"></i>{{ s.boitiers }}
            @if (s.derniereMesure) { · {{ date(s.derniereMesure) }} }
          } @else if (s.derniereMesure) {
            <!-- VIEWER: no box count, only the time of the last measure -->
            <i class="pi pi-clock"></i>{{ date(s.derniereMesure) }}
          }
        </span>
      </div>
    </article>
  `,
})
export class TbSalleCard {
  protected readonly auth = inject(AuthService);
  protected readonly unite = inject(UniteService);

  readonly r = input.required<SalleResume>();
  readonly nouvelles = input(false);
  readonly favori = output<number>();

  protected readonly icone = computed(() => iconeVariation(this.r().tendance?.variation ?? null));
  protected readonly titreConsigne = computed(() => {
    const c = this.r().salle.consigne;
    return c?.heritee ? `Consigne héritée de « ${c.sourceName} »` : 'Consigne de la salle';
  });

  protected date(v: string): string {
    return jjmmHHmm(v);
  }
}
