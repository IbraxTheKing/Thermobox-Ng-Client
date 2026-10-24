import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Courbe, courbe, dansLaCible, instants, pas } from '../../core/courbes';
import { heure, jjmmAHHmm, temps } from '../../core/dates';
import { UniteService } from '../../core/unite';
import { ClimatService } from '../../services/climat.service';
import { SerieGraphique, TbGraphique } from '../../ui/graphique';
import { TbSheet } from '../../ui/sheet';
import { SalleResume } from './resume';

const JOUR = 24 * 3_600_000;

/**
 * A card of the dashboard held down: the whole last day of the salle, larger, with what a glance
 * at the card does not say (lowest, highest, average, time spent at the consigne, last hour,
 * boxes, last measure). A sheet on a phone, a window on a computer; « Ouvrir » goes to the salle.
 *
 *   <tb-apercu-salle [r]="apercu()" (fermer)="apercu.set(null)" (favori)="basculerFavori($event)" />
 */
@Component({
  selector: 'tb-apercu-salle',
  imports: [TbSheet, TbGraphique, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(ouvert)]="ouvert" [titre]="courant()?.salle?.name ?? ''" [largeur]="760">
      @if (courant(); as r) {
        <div class="tb-apercu-salle tb-ton-{{ r.etat.ton }}">
          <p class="tb-apercu-salle-chemin">
            <span class="tb-tag tb-apercu-salle-etat"><i class="tb-lampe" aria-hidden="true"></i>{{ r.etat.label }}</span>
            @if (r.chemin) { <span>{{ r.chemin }}</span> }
          </p>

          <dl class="tb-apercu-salle-chiffres">
            <div><dt>Maintenant</dt><dd class="tb-chiffres">{{ unite.avecSymbole(r.salle.temperature) }}</dd></div>
            <div><dt>Objectif</dt><dd class="tb-chiffres">{{ r.salle.consigne?.value != null ? unite.avecSymbole(r.salle.consigne?.value) : '—' }}</dd></div>
            <div><dt>Écart</dt><dd class="tb-chiffres">{{ r.ecart != null ? unite.ecart(r.ecart) : '—' }}</dd></div>
            <div><dt>Sur une heure</dt><dd class="tb-chiffres">{{ r.tendance?.variation != null ? unite.ecart(r.tendance!.variation) : '—' }}</dd></div>
          </dl>

          <div class="tb-chart tb-apercu-salle-courbe">
            @if (graphique(); as g) {
              <tb-graphique [labels]="g.labels" [series]="g.series" [description]="'Dernières 24 heures de ' + r.salle.name" />
            } @else if (chargement()) {
              <div class="tb-apercu-salle-attente" aria-busy="true"><i class="pi pi-spinner pi-spin"></i>Chargement des 24 dernières heures…</div>
            } @else {
              <div class="tb-apercu-salle-attente">Pas de mesure ces dernières 24 heures.</div>
            }
          </div>

          <dl class="tb-apercu-salle-jour">
            <div><dt>Plus bas (24 h)</dt><dd class="tb-chiffres">{{ unite.avecSymbole(jour()?.min) }}</dd></div>
            <div><dt>Plus haut (24 h)</dt><dd class="tb-chiffres">{{ unite.avecSymbole(jour()?.max) }}</dd></div>
            <div><dt>Moyenne (24 h)</dt><dd class="tb-chiffres">{{ unite.avecSymbole(jour()?.moyenne) }}</dd></div>
            <div><dt>À l'objectif</dt><dd class="tb-chiffres">{{ cible() != null ? pourcent(cible()!) + ' du temps' : '—' }}</dd></div>
          </dl>

          <p class="tb-apercu-salle-pied">
            {{ r.salle.boitiers }} {{ r.salle.boitiers > 1 ? 'boîtiers' : 'boîtier' }}
            @if (r.salle.derniereMesure) { · dernière mesure {{ jjmmAHHmm(r.salle.derniereMesure) }} }
          </p>

          <div class="tb-apercu-salle-actions">
            <button type="button" class="tb-btn tb-tonal" (click)="favori.emit(r.salle.id)">
              <i class="pi" [class.pi-star-fill]="r.salle.favori" [class.pi-star]="!r.salle.favori"></i>{{ r.salle.favori ? 'Retirer des favoris' : 'Ajouter aux favoris' }}
            </button>
            <a class="tb-btn" [routerLink]="['/app/salle', r.salle.id]" (click)="ouvert.set(false)"><i class="pi pi-arrow-right"></i>Ouvrir</a>
          </div>
        </div>
      }
    </tb-sheet>
  `,
})
export class TbApercuSalle {
  protected readonly unite = inject(UniteService);
  private readonly climat = inject(ClimatService);

  readonly r = input<SalleResume | null>(null);
  readonly fermer = output<void>();
  readonly favori = output<number>();

  protected readonly ouvert = signal(false);
  /** Kept while the sheet closes (the input is already null by then). */
  protected readonly courant = signal<SalleResume | null>(null);
  protected readonly chargement = signal(false);
  private readonly courbeJour = signal<{ c: Courbe; temps: number[] } | null>(null);
  protected readonly jjmmAHHmm = jjmmAHHmm;

  constructor() {
    effect(() => {
      const r = this.r();
      untracked(() => {
        if (r) {
          // The same salle refreshed (a favourite toggled…): the curve stays
          const autre = this.courant()?.salle.id !== r.salle.id;
          this.courant.set(r);
          this.ouvert.set(true);
          if (autre) void this.charger(r.salle.id);
        }
      });
    });
    // Closed (cross, swipe, Escape, outside): the dashboard forgets it
    effect(() => {
      if (!this.ouvert() && untracked(() => this.r())) this.fermer.emit();
    });
  }

  protected readonly jour = computed(() => this.courbeJour()?.c ?? null);
  protected readonly cible = computed(() => {
    const c = this.courbeJour()?.c;
    return c ? dansLaCible(c, this.courant()?.salle.consigne?.value ?? null) : null;
  });

  protected readonly graphique = computed(() => {
    const j = this.courbeJour();
    const r = this.courant();
    if (!j || !r || !j.c.valeurs.some((v) => v != null)) return null;
    const consigne = r.salle.consigne?.value ?? null;
    const series: SerieGraphique[] = [
      { label: 'Température', couleur: '--tb-serie-moyenne', role: 'moyenne', valeurs: j.c.valeurs },
    ];
    if (consigne != null) series.push({ label: 'Objectif', couleur: '--tb-serie-consigne', role: 'consigne', valeurs: j.c.valeurs.map(() => consigne) });
    return { labels: j.temps.map((t) => heure(new Date(t))), series };
  });

  protected pourcent(x: number): string {
    return `${Math.round(x * 100)} %`;
  }

  private async charger(id: number): Promise<void> {
    this.courbeJour.set(null);
    this.chargement.set(true);
    const fin = Date.now();
    const debut = fin - JOUR;
    const p = pas(debut, fin);
    try {
      const r = await firstValueFrom(this.climat.moyennes([id], new Date(debut), new Date(fin), true));
      if (this.courant()?.salle.id !== id) return;
      const points = (r[String(id)] ?? []).filter((x) => x.value != null).map((x) => ({ t: temps(x.date), v: x.value! }));
      this.courbeJour.set({ c: courbe(points, debut, fin, p), temps: instants(debut, fin, p) });
    } catch {
      /* the sheet says there is nothing to show */
    } finally {
      this.chargement.set(false);
    }
  }
}
