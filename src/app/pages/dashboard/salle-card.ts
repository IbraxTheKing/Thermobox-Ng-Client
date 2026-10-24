import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { couleurEcart, couleurTemperature, teinteDouce, teinteForte } from '../../core/couleurs';
import { PreferencesService } from '../../core/preferences';
import { UniteService } from '../../core/unite';
import { TbWatch } from '../../ui/controles';
import { SalleResume } from './resume';

/**
 * A salle on the dashboard, in the look of the site (tokens.css):
 *
 * - Panneau: a square of the thermal map, coloured by its gap to the consigne;
 * - Maison: a soft tile tinted by the temperature itself, its day as a gentle curve.
 *
 * The square or tile opens into the page of the salle (data-vt: TransitionsService).
 */
@Component({
  selector: 'tb-salle-card',
  imports: [RouterLink, TbWatch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let s = r().salle;
    @if (panneau()) {
      <article
        class="tb-room tb-case tb-ton-{{ r().etat.ton }}"
        [style.--c]="caseCouleur().fond" [style.--t]="caseCouleur().texte" [style.--d]="caseCouleur().doux"
        [attr.data-flip]="s.id"
        data-vt="salle-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
      >
        <a [routerLink]="['/app/salle', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        <span class="tb-case-nom" data-vt="salle-nom" [attr.data-vt-id]="s.id">{{ s.name }}</span>
        @if (r().tendance; as t) {
          <svg class="tb-case-courbe" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path [attr.d]="t.ligne" /></svg>
        }
        <span class="tb-case-bas">
          <b class="tb-chiffres" data-vt="salle-temp" [attr.data-vt-id]="s.id" [tbWatch]="s.temperature">{{ unite.t(s.temperature) }}°</b>
          <small>{{ ecartTexte() }}</small>
        </span>
        @if (s.favori) {
          <i class="pi pi-star-fill tb-case-favori" aria-label="Favori"></i>
        }
      </article>
    } @else {
      <article
        class="tb-room tb-tuile tb-ton-{{ r().etat.ton }}"
        [style.--c]="tuile().fond" [style.--f]="tuile().fort"
        [attr.data-flip]="s.id"
        data-vt="salle-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
      >
        <a [routerLink]="['/app/salle', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        <button type="button" class="tb-tuile-favori" [class.tb-fav-on]="s.favori" [attr.aria-pressed]="s.favori"
                [title]="s.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'" (click)="favori.emit(s.id)">
          <i class="pi" [class.pi-star-fill]="s.favori" [class.pi-star]="!s.favori"></i>
        </button>
        <span class="tb-tuile-nom" data-vt="salle-nom" [attr.data-vt-id]="s.id">{{ s.name }}</span>
        <span class="tb-tuile-t tb-chiffres" data-vt="salle-temp" [attr.data-vt-id]="s.id" [tbWatch]="s.temperature">{{ unite.t(s.temperature) }}<span>°</span></span>
        <span class="tb-tuile-etat">
          @if (r().etat.ton === 'stable') { Confortable } @else { <b>{{ etatMaison() }}</b> }
          @if (s.consigne?.value != null) { · {{ unite.t(s.consigne?.value) }}° }
        </span>
        @if (r().tendance; as t) {
          <svg class="tb-tuile-courbe" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
            <path class="tb-tuile-aire" [attr.d]="t.aire" /><path class="tb-tuile-ligne" [attr.d]="t.ligne" />
          </svg>
        }
      </article>
    }
  `,
})
export class TbSalleCard {
  protected readonly unite = inject(UniteService);
  private readonly prefs = inject(PreferencesService);

  readonly r = input.required<SalleResume>();
  readonly nouvelles = input(false);
  readonly favori = output<number>();

  protected readonly panneau = computed(() => this.prefs.style() === 'panneau');
  private readonly sombre = computed(() => this.prefs.theme() === 'dark');

  protected readonly caseCouleur = computed(() => couleurEcart(this.r().ecart, this.sombre()));
  protected readonly ecartTexte = computed(() => {
    const e = this.r().ecart;
    if (e == null) return this.r().salle.temperature == null ? 'pas de mesure' : 'sans consigne';
    return Math.abs(e) < 0.05 ? 'à la consigne' : this.unite.ecart(e);
  });

  protected readonly tuile = computed(() => {
    const c = couleurTemperature(this.r().salle.temperature);
    return { fond: teinteDouce(c, this.sombre()), fort: teinteForte(c, this.sombre()) };
  });
  protected readonly etatMaison = computed(() => ({ chauffe: 'Chauffe', chaud: 'Un peu chaud', inconnu: 'Pas de mesure', stable: 'Confortable' })[this.r().etat.ton]);
}
