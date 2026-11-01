import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { couleurEcart, couleurPiece, teinteDouce, teinteForte } from '../../core/couleurs';
import { PlateformeService } from '../../core/plateforme';
import { PreferencesService } from '../../core/preferences';
import { UniteService } from '../../core/unite';
import { TbWatch } from '../../ui/controles';
import { TbPhotoImg } from '../../ui/photo';
import { SalleResume } from './resume';

/**
 * A salle on the dashboard, in the look of the site (tokens.css):
 *
 * - Panneau: a square of the thermal map, coloured by its gap to the consigne;
 * - Maison: a soft tile tinted by its gap to the consigne (or its temperature: Préférences), its
 *   day as a gentle curve.
 *
 * Its photo, when it has one, lies behind it under the colour (part of the card when it morphs
 * into the page of the salle: it does not fly on its own above the words).
 *
 * Held down (finger or mouse, half a second): its whole day and its details (TbApercuSalle), and
 * the click that follows does not open the salle.
 *
 * The square or tile opens into the page of the salle (data-vt: TransitionsService).
 */
@Component({
  selector: 'tb-salle-card',
  imports: [RouterLink, TbWatch, TbPhotoImg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @let s = r().salle;
    @if (panneau()) {
      <article
        class="tb-room tb-case tb-ton-{{ r().etat.ton }}" [class.tb-avec-photo]="s.image != null"
        [style.--c]="caseCouleur().fond" [style.--t]="caseCouleur().texte" [style.--d]="caseCouleur().doux"
        [attr.data-flip]="s.id"
        data-vt="salle-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
        [class.tb-appui]="appui()"
        (pointerdown)="presser($event)" (contextmenu)="menu($event)"
      >
        <a [routerLink]="['/app/salle', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        @if (s.image != null) {
          <span class="tb-case-photo"><tb-photo-img [salleId]="s.id" [version]="s.image" /></span>
        }
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
        class="tb-room tb-tuile tb-ton-{{ r().etat.ton }}" [class.tb-avec-photo]="s.image != null"
        [style.--c]="tuile().fond" [style.--f]="tuile().fort"
        [attr.data-flip]="s.id"
        data-vt="salle-card" [attr.data-vt-id]="s.id"
        style="view-transition-class: tb-card"
        [class.tb-appui]="appui()"
        (pointerdown)="presser($event)" (contextmenu)="menu($event)"
      >
        <a [routerLink]="['/app/salle', s.id]" class="tb-stretched" [title]="'Ouvrir ' + s.name">
          <span class="tb-sr-only">Ouvrir {{ s.name }}</span>
        </a>
        <button type="button" class="tb-tuile-favori" [class.tb-fav-on]="s.favori" [attr.aria-pressed]="s.favori"
                [title]="s.favori ? 'Retirer des favoris' : 'Ajouter aux favoris'" (click)="favori.emit(s.id)">
          <i class="pi" [class.pi-star-fill]="s.favori" [class.pi-star]="!s.favori"></i>
        </button>
        @if (s.image != null) {
          <span class="tb-tuile-photo"><tb-photo-img [salleId]="s.id" [version]="s.image" /></span>
        }
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
  /** Held down: the overview of the salle. */
  readonly apercu = output<number>();

  private readonly plateforme = inject(PlateformeService);
  /** Being held: the card sinks a little, to say something is coming. */
  protected readonly appui = signal(false);
  private minuterie?: ReturnType<typeof setTimeout>;
  /** The overview opened: the click of the release must not open the salle. */
  private avale = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.minuterie));
    // Caught on the way down, before the link of the card sees it
    (inject(ElementRef).nativeElement as HTMLElement).addEventListener('click', (e) => this.clic(e), { capture: true });
  }

  protected presser(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.tb-tuile-favori')) return;
    this.avale = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cible = e.currentTarget as HTMLElement;
    const annuler = () => {
      clearTimeout(this.minuterie);
      this.appui.set(false);
      cible.removeEventListener('pointermove', bouger);
      cible.removeEventListener('pointerup', annuler);
      cible.removeEventListener('pointercancel', annuler);
      cible.removeEventListener('pointerleave', annuler);
      removeEventListener('scroll', annuler, true);
    };
    // A finger that moves scrolls the page: not a long press
    const bouger = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) annuler();
    };
    cible.addEventListener('pointermove', bouger);
    cible.addEventListener('pointerup', annuler);
    cible.addEventListener('pointercancel', annuler);
    cible.addEventListener('pointerleave', annuler);
    addEventListener('scroll', annuler, { capture: true, passive: true });
    // Sinks only after a moment: a quick tap shows nothing
    this.minuterie = setTimeout(() => {
      this.appui.set(true);
      this.minuterie = setTimeout(() => {
        annuler();
        this.avale = true;
        this.plateforme.vibrer(true);
        this.apercu.emit(this.r().salle.id);
      }, 330);
    }, 150);
  }

  protected clic(e: MouseEvent): void {
    if (!this.avale) return;
    this.avale = false;
    e.preventDefault();
    e.stopPropagation();
  }

  /** The menu of the system (long press on a link) never shows over a card. */
  protected menu(e: Event): void {
    if (e instanceof PointerEvent && e.pointerType === 'mouse') return;
    e.preventDefault();
  }

  protected readonly panneau = computed(() => this.prefs.style() === 'panneau');
  private readonly sombre = computed(() => this.prefs.theme() === 'dark');

  protected readonly caseCouleur = computed(() => couleurEcart(this.r().ecart, this.sombre(), this.prefs.tolerance()));
  protected readonly ecartTexte = computed(() => {
    const e = this.r().ecart;
    if (e == null) return this.r().salle.temperature == null ? 'pas de mesure' : 'sans consigne';
    return Math.abs(e) < 0.05 ? 'à la consigne' : this.unite.ecart(e);
  });

  protected readonly tuile = computed(() => {
    const s = this.r().salle;
    const c = couleurPiece(s.temperature, s.consigne?.value, this.prefs.couleursMaison(), this.prefs.tolerance());
    return { fond: teinteDouce(c, this.sombre()), fort: teinteForte(c, this.sombre()) };
  });
  protected readonly etatMaison = computed(() => ({ chauffe: 'Chauffe', chaud: 'Un peu chaud', inconnu: 'Pas de mesure', stable: 'Confortable' })[this.r().etat.ton]);
}
