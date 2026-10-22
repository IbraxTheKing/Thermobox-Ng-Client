import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { PointT, pourGraphique } from '../../core/courbes';
import { complet, jjmmAHHmm, jjmmHHmm, temps, versChamp } from '../../core/dates';
import { etatDe } from '../../core/etat';
import { ConfirmService, ToastService } from '../../core/messages';
import { PlateformeService } from '../../core/plateforme';
import { TitreService } from '../../core/titre';
import { TransitionsService } from '../../core/transitions';
import { UniteService } from '../../core/unite';
import { DetailElement, Historique, Noeud, Point } from '../../models/models';
import { ArbreStore, LIBELLES } from '../../services/arbre.store';
import { ClimatService } from '../../services/climat.service';
import { FavoriService } from '../../services/favori.service';
import { HierarchieService } from '../../services/hierarchie.service';
import { ImagesService } from '../../services/images.service';
import { SalleService } from '../../services/salle.service';
import { TbStepper, TbSwitch, TbWatch } from '../../ui/controles';
import { SerieGraphique, TbGraphique } from '../../ui/graphique';
import { TbPhotoImg } from '../../ui/photo';

/** One colour per box or salle, defined by the theme (light and dark differ). */
const PALETTE = Array.from({ length: 8 }, (_, i) => `--tb-serie-${i + 1}`);
const CONSIGNE_PAR_DEFAUT = 20;
const TAILLE_MAX_PHOTO = 10 * 1024 * 1024;

/**
 * Page of an element (salle.xhtml): average of its boxes, consigne, photo, history. A salle shows
 * its boxes; an étage or a bâtiment shows its salles (tiles and curves). Refreshed every 30 s.
 */
@Component({
  selector: 'tb-salle',
  imports: [RouterLink, TbStepper, TbSwitch, TbWatch, TbGraphique, TbPhotoImg],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './salle.html',
})
export class SallePage implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly unite = inject(UniteService);
  private readonly climat = inject(ClimatService);
  private readonly salles = inject(SalleService);
  private readonly hierarchie = inject(HierarchieService);
  private readonly favoris = inject(FavoriService);
  private readonly images = inject(ImagesService);
  private readonly store = inject(ArbreStore);
  private readonly transitions = inject(TransitionsService);
  protected readonly tel = inject(PlateformeService).telephone;
  /** Phones: the « Du / Au » fields are shown. */
  protected readonly plagePerso = signal(false);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly titre = inject(TitreService);
  private readonly plateforme = inject(PlateformeService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Route parameter :id */
  readonly id = input.required<string>();

  protected readonly detail = signal<DetailElement | null>(null);
  protected readonly introuvable = signal(false);
  protected readonly libelles = LIBELLES;

  // Consigne
  protected readonly nouvelleConsigne = signal<number | null>(null);
  protected readonly forcer = signal(false);
  protected readonly envoi = signal(false);

  // History
  /** Shortcut in use (24, 168 or 720 h), null once dates were picked by hand. */
  protected readonly periodeHeures = signal<number | null>(24);
  protected readonly debut = signal(versChamp(new Date(Date.now() - 24 * 3_600_000)));
  protected readonly fin = signal(versChamp(new Date()));
  protected readonly historique = signal<Historique | null>(null);
  protected readonly pageConsignes = signal(0);

  protected readonly photoEnCours = signal(false);

  private minuterie?: ReturnType<typeof setInterval>;

  protected readonly element = computed(() => this.detail()?.element ?? null);
  protected readonly kind = computed(() => this.element()?.kind);
  protected readonly boitier = computed(() => this.kind() === 'BOITIER');
  protected readonly conteneur = computed(() => this.kind() === 'ETAGE' || this.kind() === 'BATIMENT');
  /** Only salles go on the dashboard, so only they can be favourites. */
  protected readonly salleSimple = computed(() => this.kind() === 'SALLE');
  protected readonly etat = computed(() => etatDe(this.element()?.temperature, this.element()?.consigne?.value));
  protected readonly derniereMesure = computed(() => this.element()?.derniereMesure ?? null);

  /** « Étage 1 (19,0 °C), Everest (22,5 °C) » */
  protected readonly consignesPropresLabel = computed(() =>
    (this.detail()?.consignesPropres ?? []).map((c) => `${c.sourceName} (${this.unite.t(c.value)} ${this.unite.symbole()})`).join(', '),
  );

  protected readonly graphique = computed(() => {
    const h = this.historique();
    const e = this.element();
    if (!h || !e) return null;
    const series: { label: string; couleur: string; role?: 'consigne' | 'moyenne'; points: PointT[]; marches?: boolean }[] = [];
    if (this.conteneur()) {
      // One curve per salle (average of its boxes) rather than one per box
      h.salles.forEach((s, i) => series.push({ label: s.name ?? '', couleur: PALETTE[i % PALETTE.length], points: pts(s.points) }));
      if (h.salles.length > 1) {
        series.push({ label: e.kind === 'ETAGE' ? "Moyenne de l'étage" : 'Moyenne du bâtiment', couleur: '--tb-serie-moyenne', role: 'moyenne', points: pts(h.moyenne) });
      }
    } else if (!h.boitiers.length) {
      // VIEWER: the salle's temperature only, not one curve per box
      if (h.moyenne.length) series.push({ label: 'Température', couleur: '--tb-serie-moyenne', role: 'moyenne', points: pts(h.moyenne) });
    } else {
      h.boitiers.forEach((b, i) => series.push({ label: b.name ?? '', couleur: PALETTE[i % PALETTE.length], points: pts(b.points) }));
      // A single box is its own average: no need for a duplicate curve
      if (h.boitiers.length > 1) series.push({ label: 'Moyenne de la salle', couleur: '--tb-serie-moyenne', role: 'moyenne', points: pts(h.moyenne) });
    }
    series.push({ label: 'Consigne', couleur: '--tb-serie-consigne', role: 'consigne', points: pts(h.consignes), marches: true });
    const avecPoints = series.filter((s) => s.points.length);
    const { temps: t, valeurs } = pourGraphique(avecPoints);
    return {
      labels: t.map((x) => jjmmHHmm(new Date(x))),
      series: avecPoints.map((s, i): SerieGraphique => ({ label: s.label, couleur: s.couleur, role: s.role, valeurs: valeurs[i] })),
    };
  });

  /** Consignes of the period, newest first, ten per page. */
  protected readonly consignesPeriode = computed(() =>
    [...(this.historique()?.consignes ?? [])].sort((a, b) => temps(b.date) - temps(a.date)),
  );
  protected readonly pagesConsignes = computed(() => Math.max(1, Math.ceil(this.consignesPeriode().length / 10)));

  constructor() {
    // The page takes the colour of the state of the salle, at once from what the dashboard
    // already knows (it then comes with the card that morphs into this page)
    const connu = this.store.parId().get(Number(inject(ActivatedRoute).snapshot.paramMap.get('id')));
    if (connu) this.transitions.definirTon(etatDe(connu.temperature, connu.consigne?.value).ton);
    effect(() => {
      const e = this.element();
      if (e) this.transitions.definirTon(this.etat().ton);
    });
    inject(DestroyRef).onDestroy(() => this.transitions.definirTon(null));
    effect(() => {
      const id = Number(this.id());
      untracked(() => void this.ouvrir(id));
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.minuterie);
  }

  private async ouvrir(id: number): Promise<void> {
    clearInterval(this.minuterie);
    this.detail.set(null);
    this.introuvable.set(false);
    this.historique.set(null);
    this.nouvelleConsigne.set(null);
    this.forcer.set(false);
    this.periode(24, false);
    if (isNaN(id)) {
      this.introuvable.set(true);
      return;
    }
    // What the dashboard already knows (name, temperature, consigne, place): the page is there at
    // once, so the card has a page to morph into, the rest comes with the server's answer
    const connu = this.store.parId().get(id);
    if (connu) {
      this.detail.set({
        element: connu,
        ancetres: this.store.chemin(id).map((a) => ({ id: a.id, name: a.name, kind: a.kind, accessible: a.accessible })),
        enfants: [],
        mesures: [],
        consignesPropres: [],
        salles: [],
      });
      this.titre.definir(connu.name ?? 'Salle');
    }
    await this.rafraichir(id, false);
    if (!this.detail()) return;
    void this.chargerHistorique();
    this.minuterie = setInterval(() => void this.rafraichir(id, true), 30_000);
  }

  private async rafraichir(id: number, discret: boolean): Promise<void> {
    try {
      const d = await firstValueFrom(this.salles$(id, discret));
      this.detail.set(d);
      this.titre.definir(d.element.name ?? 'Salle');
      // The stepper starts from the current consigne, in the unit of the Préférences page
      if (this.nouvelleConsigne() == null) this.nouvelleConsigne.set(this.unite.pourSaisie(d.element.consigne?.value ?? CONSIGNE_PAR_DEFAUT));
    } catch (e) {
      if (discret && this.detail()) {
        // Accesses withdrawn while the page was open: nothing more is shown
        if ((e as { status?: number }).status === 404) {
          this.detail.set(null);
          this.introuvable.set(true);
          this.toasts.warn("Vous n'avez plus accès à cet élément");
        }
        return;
      }
      this.detail.set(null);
      this.introuvable.set(true);
      this.titre.definir('Élément introuvable');
    }
  }

  private salles$(id: number, discret: boolean) {
    return this.hierarchie.detail(id, discret);
  }

  /** Back to where we came from (the dashboard card returns to its place), else to the dashboard. */
  protected retour(e: Event): void {
    e.preventDefault();
    const etat = this.location.getState() as { navigationId?: number } | null;
    if (etat?.navigationId && etat.navigationId > 1) this.location.back();
    else void this.router.navigateByUrl('/app/apercu');
  }

  // ---------------------------------------------------------------- favourite

  protected async basculerFavori(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const favori = !d.element.favori;
    this.majElement({ ...d.element, favori });
    this.plateforme.vibrer();
    try {
      await firstValueFrom(favori ? this.favoris.ajouter(d.element.id) : this.favoris.retirer(d.element.id));
      const n = this.store.parId().get(d.element.id);
      if (n) this.store.remplacer({ ...n, favori });
    } catch (err) {
      this.majElement({ ...d.element, favori: !favori });
      this.toasts.error('Impossible de modifier les favoris', messageErreur(err));
    }
  }

  private majElement(n: Noeud): void {
    const d = this.detail();
    if (d) this.detail.set({ ...d, element: n });
  }

  // ---------------------------------------------------------------- consigne

  /**
   * Saves the consigne on the element; what it contains follows it, except the étages / salles
   * that have their own consigne, unless « Forcer » is on.
   */
  protected async envoyerConsigne(): Promise<void> {
    const e = this.element();
    const saisie = this.nouvelleConsigne();
    if (!e) return;
    if (saisie == null) {
      this.toasts.warn('Indique une température');
      return;
    }
    const celsius = this.unite.saisieVersCelsius(saisie);
    this.envoi.set(true);
    try {
      const r = await firstValueFrom(this.climat.envoyerConsigne(e.id, celsius, this.forcer()));
      const titre = `Consigne de ${this.unite.t(celsius)} ${this.unite.symbole()} enregistrée`;
      const details = [
        r.boitiers.length ? `envoyée à ${r.boitiers.length} boîtier(s)` : 'aucun boîtier à prévenir',
        r.remplacees.length ? `remplace celle de ${r.remplacees.map((x) => x.name).join(', ')}` : null,
        r.conservees.length ? `${r.conservees.map((x) => x.sourceName).join(', ')} garde(nt) sa consigne` : null,
      ]
        .filter(Boolean)
        .join(' ; ');
      const texte = details.charAt(0).toUpperCase() + details.slice(1);
      if (r.echecs.length) this.toasts.warn(titre, `${texte}. Non transmise à : ${r.echecs.map((x) => x.name).join(', ')}`);
      else this.toasts.info(titre, texte);
      this.nouvelleConsigne.set(null);
      this.forcer.set(false);
      await this.rafraichir(e.id, true);
      void this.chargerHistorique();
    } catch (err) {
      this.toasts.error('Consigne refusée', messageErreur(err));
    } finally {
      this.envoi.set(false);
    }
  }

  // ---------------------------------------------------------------- history

  /** Shortcuts 24 h / 7 j / 30 j */
  protected periode(heures: number, charger = true): void {
    this.periodeHeures.set(heures);
    this.plagePerso.set(false);
    const fin = new Date();
    fin.setSeconds(0, 0);
    this.fin.set(versChamp(fin));
    this.debut.set(versChamp(new Date(fin.getTime() - heures * 3_600_000)));
    if (charger) void this.chargerHistorique();
  }

  /** "Afficher", with the dates picked by hand. */
  protected afficher(): void {
    this.periodeHeures.set(null);
    void this.chargerHistorique();
  }

  private async chargerHistorique(): Promise<void> {
    const e = this.element();
    if (!e) return;
    const debut = new Date(this.debut());
    const fin = new Date(this.fin());
    if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut >= fin) {
      this.toasts.error('La date de début doit précéder la date de fin');
      return;
    }
    try {
      this.historique.set(await firstValueFrom(this.climat.historique(e.id, debut, fin)));
      this.pageConsignes.set(0);
    } catch (err) {
      this.toasts.error("Impossible de charger l'historique", messageErreur(err));
    }
  }

  // ---------------------------------------------------------------- photo (ADMIN)

  protected async televerser(ev: Event): Promise<void> {
    const champ = ev.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    champ.value = '';
    const e = this.element();
    if (!fichier || !e) return;
    if (!/^image\/(jpe?g|png|gif|bmp)$/i.test(fichier.type) && !/\.(jpe?g|png|gif|bmp)$/i.test(fichier.name)) {
      this.toasts.error('Photo refusée', 'Choisis une image JPEG, PNG, GIF ou BMP.');
      return;
    }
    if (fichier.size > TAILLE_MAX_PHOTO) {
      this.toasts.error('Photo refusée', "L'image ne doit pas dépasser 10 Mo.");
      return;
    }
    this.photoEnCours.set(true);
    try {
      const version = await firstValueFrom(this.salles.putImage(e.id, fichier));
      this.images.oublier(e.id);
      this.majElement({ ...e, image: version });
      this.toasts.info('Photo enregistrée');
    } catch (err) {
      this.toasts.error("Impossible d'enregistrer la photo", messageErreur(err));
    } finally {
      this.photoEnCours.set(false);
    }
  }

  protected async retirerPhoto(): Promise<void> {
    const e = this.element();
    if (!e) return;
    const ok = await this.confirm.demander('Retirer la photo', `La photo de « ${e.name} » sera supprimée.`, { confirmer: 'Retirer' });
    if (!ok) return;
    try {
      await firstValueFrom(this.salles.deleteImage(e.id));
      this.images.oublier(e.id);
      this.majElement({ ...e, image: null });
      this.toasts.info('Photo retirée');
    } catch (err) {
      this.toasts.error('Impossible de retirer la photo', messageErreur(err));
    }
  }

  // ---------------------------------------------------------------- formats

  protected ecartBoitier(v: number | null): string {
    const moy = this.element()?.temperature;
    return v == null || moy == null ? '' : this.unite.ecart(v - moy);
  }

  protected jjmmAHHmm = jjmmAHHmm;
  protected jjmmHHmm = jjmmHHmm;
  protected complet = complet;

  protected tonDe(n: Noeud): string {
    return etatDe(n.temperature, n.consigne?.value).ton;
  }

  protected etatLabel(n: Noeud): string {
    return etatDe(n.temperature, n.consigne?.value).label;
  }
}

function pts(l: Point[]): PointT[] {
  return l
    .filter((p) => p.value != null)
    .map((p) => ({ t: temps(p.date), v: p.value! }))
    .filter((p) => !isNaN(p.t));
}
