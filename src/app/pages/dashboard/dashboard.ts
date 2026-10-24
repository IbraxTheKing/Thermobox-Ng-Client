import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { AvisMajService } from '../../core/avis-maj';
import { PointT, Sparkline, sparkline } from '../../core/courbes';
import { heure, temps } from '../../core/dates';
import { ETATS, EtatSalle, ORDRE_ETATS, compte, etatDe } from '../../core/etat';
import { ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { PlateformeService } from '../../core/plateforme';
import { PreferencesService } from '../../core/preferences';
import { TransitionsService } from '../../core/transitions';
import { correspond, normaliser, parNom, pluriel } from '../../core/texte';
import { UniteService } from '../../core/unite';
import { Noeud, Point } from '../../models/models';
import { ArbreStore } from '../../services/arbre.store';
import { TirerPourActualiser } from '../../ui/tirer';
import { CacheCourbes } from '../../core/cache-courbes';
import { ClimatService } from '../../services/climat.service';
import { FavoriService } from '../../services/favori.service';
import { PlageEcart } from './plage-ecart';
import { TbSalleCard } from './salle-card';
import { SalleResume } from './resume';

/** The salles of a bâtiment (or those without bâtiment when [batiment] is null). */
interface GroupeBatiment {
  batiment: Noeud | null;
  nom: string;
  /** Panneau: the salles of each étage, one row of squares (nom null: directly in the bâtiment). */
  etages: { nom: string | null; cle: string; salles: SalleResume[] }[];
  /** Key of the section in the folded sections (see replie). */
  cle: string;
  moyenne: number | null;
  salles: SalleResume[];
}

const SANS_BATIMENT = -1;
const CLE_SECTIONS = 'tb-sections';
const PERIODE_TENDANCE = 24 * 3_600_000;
const VALIDITE_TENDANCES = 5 * 60_000;
const CLE_TENDANCES = 'apercu';
const SONDAGE = 30_000;

/**
 * Aperçu (dashboard.xhtml): every salle the user may see, as a card with its temperature, state,
 * consigne and its curve over 24 h; favourites first, then one section per bâtiment. Refreshed
 * every 30 seconds.
 */
@Component({
  selector: 'tb-dashboard',
  imports: [RouterLink, TbSalleCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  // Computers: the size of the cards (the slider of the header)
  host: { '[style.--z]': 'prefs.tailleCartes()' },
})
export class DashboardPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(ArbreStore);
  protected readonly unite = inject(UniteService);
  protected readonly avis = inject(AvisMajService);
  private readonly climat = inject(ClimatService);
  private readonly favorisApi = inject(FavoriService);
  private readonly toasts = inject(ToastService);
  private readonly plateforme = inject(PlateformeService);
  private readonly transitions = inject(TransitionsService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly plage = inject(PlageEcart);
  /** Look of the site: the thermal map (Panneau) or the tiles of a home (Maison). */
  protected readonly panneau = computed(() => this.prefs.style() === 'panneau');
  /** Cards glide to their new places when a filter or a favourite changes them. */
  private readonly flip = inject(FlipService);

  // Filters
  protected readonly recherche = signal('');
  protected readonly etatFiltre = signal<EtatSalle | null>(null);

  constructor() {
    // The page takes the colour of the state picked (« Couleurs selon l'état »)
    effect(() => this.transitions.definirTon(this.etatFiltre()?.ton ?? null));
    inject(DestroyRef).onDestroy(() => this.transitions.definirTon(null));
  }
  protected readonly batimentId = signal<number | null>(null);

  /** Curves of the last 24 h by salle: undefined while they load, null without enough measures. */
  private readonly cache = inject(CacheCourbes);
  /** Phones: pull the page down to refresh it (the button is then hidden). */
  protected readonly tirer = inject(TirerPourActualiser).activer(() => this.actualiser());
  /** Kept in memory (CacheCourbes): back on the dashboard, the curves are there at once. */
  private readonly tendancesGardees = this.cache.lire<Map<number, Sparkline | null>>(CLE_TENDANCES);
  private readonly tendances = signal<Map<number, Sparkline | null> | null>(this.tendancesGardees?.valeur ?? null);
  private tendancesCalculees = this.tendancesGardees ? Date.now() - this.tendancesGardees.age : 0;
  /** True in the refresh that brings the curves: they draw themselves once. */
  protected readonly courbesNouvelles = signal(false);

  protected readonly replies = signal<Set<string>>(lireSections());
  private minuterie?: ReturnType<typeof setInterval>;

  /** Every card, before filtering. */
  protected readonly toutes = computed<SalleResume[]>(() => {
    const tendances = this.tendances();
    return this.store.salles().map((salle) => {
      const consigne = salle.consigne?.value ?? null;
      return {
        salle,
        chemin: this.store.cheminTexte(salle.id),
        batiment: this.store.batimentDe(salle.id),
        etat: etatDe(salle.temperature, consigne),
        ecart: salle.temperature != null && consigne != null ? salle.temperature - consigne : null,
        tendance: tendances ? (tendances.get(salle.id) ?? null) : undefined,
      };
    });
  });

  protected readonly batiments = computed(() => [...this.store.batiments()].sort(parNom((b) => b.name)));

  /** One chip per state that at least one salle is in. */
  protected readonly compteurs = computed(() => {
    const parEtat = new Map<EtatSalle, number>();
    for (const r of this.toutes()) parEtat.set(r.etat, (parEtat.get(r.etat) ?? 0) + 1);
    return ORDRE_ETATS.filter((e) => parEtat.has(e)).map((etat) => ({ etat, nombre: parEtat.get(etat)!, texte: compte(etat, parEtat.get(etat)!) }));
  });

  private readonly visibles = computed(() => {
    const b = this.batimentId();
    const recherche = this.recherche();
    const etat = this.etatFiltre();
    return this.toutes()
      .filter((r) => b == null || (b === SANS_BATIMENT ? r.batiment == null : r.batiment?.id === b))
      .filter((r) => !recherche.trim() || correspond(`${r.salle.name} ${r.chemin}`, recherche))
      .filter((r) => etat == null || r.etat === etat)
      .filter((r) => !this.panneau() || this.dansPlage(r.ecart))
      .sort(parNom((r) => r.salle.name));
  });

  // ---------------------------------------------------------------- Panneau: the scale

  /** The scale spans ±2.5 tolerances: beyond, the colour no longer changes. */
  protected readonly etendue = computed(() => Math.round(2.5 * this.prefs.tolerance() * 10) / 10);
  protected readonly plageActive = computed(() => this.plage.bas() != null || this.plage.haut() != null);
  /** Position of a gap on the bar, 0-100. */
  protected pourcent(ecart: number): number {
    const e = this.etendue();
    return ((Math.max(-e, Math.min(e, ecart)) + e) / (2 * e)) * 100;
  }
  private dansPlage(ecart: number | null): boolean {
    const bas = this.plage.bas();
    const haut = this.plage.haut();
    if (bas == null && haut == null) return true;
    if (ecart == null) return false;
    return (bas == null || ecart >= bas - 1e-9) && (haut == null || ecart <= haut + 1e-9);
  }
  /** Each salle as a tick on the bar, where its gap puts it. */
  protected readonly marques = computed(() =>
    this.toutes()
      .filter((r) => r.ecart != null)
      .map((r) => ({ id: r.salle.id, nom: r.salle.name ?? '', ecart: r.ecart!, pct: this.pourcent(r.ecart!), dedans: this.dansPlage(r.ecart) })),
  );
  /** A handle moved: at the end of the bar, no bound on that side. */
  protected poserBorne(cote: 'bas' | 'haut', valeur: number): void {
    const e = this.etendue();
    const v = Math.round(valeur * 10) / 10;
    this.flip.animer(() => {
      if (cote === 'bas') this.plage.bas.set(v <= -e ? null : Math.min(v, this.plage.haut() ?? e));
      else this.plage.haut.set(v >= e ? null : Math.max(v, this.plage.bas() ?? -e));
    });
  }
  protected toutAfficher(): void {
    this.flip.animer(() => {
      this.plage.bas.set(null);
      this.plage.haut.set(null);
    });
  }
  protected poserTolerance(t: number): void {
    this.prefs.tolerance.set(t);
    // The bounds stay inside the new scale
    const e = this.etendue();
    if (this.plage.bas() != null && this.plage.bas()! <= -e) this.plage.bas.set(null);
    if (this.plage.haut() != null && this.plage.haut()! >= e) this.plage.haut.set(null);
  }
  /** « De −1,0 °C à +2,0 °C », « +1,0 °C et plus »… */
  protected readonly textePlage = computed(() => {
    const b = this.plage.bas();
    const h = this.plage.haut();
    if (b == null && h == null) return '';
    if (b == null) return `${this.unite.ecart(h)} et moins`;
    if (h == null) return `${this.unite.ecart(b)} et plus`;
    return `De ${this.unite.ecart(b)} à ${this.unite.ecart(h)}`;
  });
  protected readonly nombreVisibles = computed(() => this.visibles().length);

  protected readonly favoris = computed(() => this.visibles().filter((r) => r.salle.favori));

  /** Average of each bâtiment shown in its section title. */
  private readonly moyennesBatiments = computed(() => {
    const m = new Map<number | null, number | null>();
    if (this.store.tout()) {
      // Average of every box of the building, not of the salle averages (salles differ in size)
      for (const b of this.store.batiments()) m.set(b.id, b.temperature);
    } else {
      // Limited user: over the salles they may see only, weighted by their number of boxes
      const parBatiment = new Map<number | null, { somme: number; n: number }>();
      for (const r of this.toutes()) {
        if (r.salle.temperature == null || r.salle.boitiers <= 0) continue;
        const k = r.batiment?.id ?? null;
        const acc = parBatiment.get(k) ?? { somme: 0, n: 0 };
        acc.somme += r.salle.temperature * r.salle.boitiers;
        acc.n += r.salle.boitiers;
        parBatiment.set(k, acc);
      }
      for (const [k, v] of parBatiment) m.set(k, v.somme / v.n);
    }
    return m;
  });

  /** A favourite is shown once, in its own section. */
  protected readonly groupes = computed<GroupeBatiment[]>(() => {
    const parBatiment = new Map<number | null, SalleResume[]>();
    for (const r of this.visibles().filter((x) => !x.salle.favori)) {
      const k = r.batiment?.id ?? null;
      parBatiment.set(k, [...(parBatiment.get(k) ?? []), r]);
    }
    const moyennes = this.moyennesBatiments();
    return [...parBatiment.entries()]
      .map(([id, salles]) => {
        const batiment = salles[0].batiment;
        return { batiment, nom: batiment?.name ?? 'Sans bâtiment', cle: id != null ? `b${id}` : 'sans', moyenne: moyennes.get(id) ?? null, salles, etages: this.parEtage(salles) };
      })
      .sort((a, b) => Number(a.batiment == null) - Number(b.batiment == null) || normaliser(a.nom).localeCompare(normaliser(b.nom), 'fr'));
  });

  /** Panneau: one row per étage, in the order of their names; the salles without étage first. */
  private parEtage(salles: SalleResume[]): GroupeBatiment['etages'] {
    const m = new Map<number | null, { nom: string | null; cle: string; salles: SalleResume[] }>();
    for (const r of salles) {
      const etage = this.store.chemin(r.salle.id).find((n) => n.kind === 'ETAGE') ?? null;
      const k = etage?.id ?? null;
      const g = m.get(k) ?? { nom: etage?.name ?? null, cle: k == null ? 'sans' : `e${k}`, salles: [] };
      g.salles.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => Number(a.nom != null) - Number(b.nom != null) || normaliser(a.nom ?? '').localeCompare(normaliser(b.nom ?? ''), 'fr', { numeric: true }));
  }

  /** Panneau: the state counters at the top, every state even at zero (a desk shows its lamps). */
  protected readonly voyants = computed(() => {
    const parEtat = new Map<EtatSalle, number>();
    for (const r of this.toutes()) parEtat.set(r.etat, (parEtat.get(r.etat) ?? 0) + 1);
    const l: { etat: EtatSalle; nombre: number }[] = [ETATS.TROP_CHAUD, ETATS.EN_CHAUFFE, ETATS.STABLE].map((etat) => ({ etat, nombre: parEtat.get(etat) ?? 0 }));
    if (parEtat.get(ETATS.INCONNU)) l.push({ etat: ETATS.INCONNU, nombre: parEtat.get(ETATS.INCONNU)! });
    return l;
  });
  protected readonly nomsVoyants: Record<string, string> = { chaud: 'Trop chaudes', chauffe: 'En chauffe', stable: 'Stables', inconnu: 'Sans mesure' };

  /** Panneau: time of the last measure received, any salle. */
  protected readonly dernierReleve = computed(() => {
    const t = Math.max(0, ...this.toutes().map((r) => (r.salle.derniereMesure ? temps(r.salle.derniereMesure) : 0)).filter((x) => !isNaN(x)));
    return t > 0 ? heure(new Date(t)) : null;
  });

  /**
   * Maison: the house in one sentence, what a person wants to know first. « Il fait bon partout. »,
   * or what is not comfortable, by name. Parts in bold: the names.
   */
  protected readonly phrase = computed<{ texte: string; nom?: boolean }[]>(() => {
    const toutes = this.toutes();
    if (!toutes.length) return [];
    const par = (ton: string) => toutes.filter((r) => r.etat.ton === ton).map((r) => r.salle.name ?? '');
    const chaudes = par('chaud');
    const chauffent = par('chauffe');
    const inconnues = par('inconnu');
    if (!chaudes.length && !chauffent.length && !inconnues.length) return [{ texte: toutes.length > 1 ? 'Il fait bon partout.' : 'Il fait bon.' }];
    const morceaux: { texte: string; nom?: boolean }[] = [];
    const stables = toutes.length - chaudes.length - chauffent.length - inconnues.length;
    if (stables >= toutes.length / 2) morceaux.push({ texte: 'Il fait bon presque partout. ' });
    const noms = (l: string[]) => {
      // More than three: a count rather than a list
      if (l.length > 3) return [{ texte: `${l.length} pièces` }];
      return l.flatMap((n, i) => [...(i ? [{ texte: i === l.length - 1 ? ' et ' : ', ' }] : []), { texte: n, nom: true }]);
    };
    const phrases: { texte: string; nom?: boolean }[][] = [];
    if (chauffent.length) phrases.push([...noms(chauffent), { texte: chauffent.length > 1 ? ' chauffent' : ' chauffe' }]);
    if (chaudes.length) phrases.push([{ texte: 'il fait un peu chaud dans ' }, ...noms(chaudes)]);
    if (inconnues.length) phrases.push([{ texte: 'pas de mesure pour ' }, ...noms(inconnues)]);
    phrases.forEach((p, i) => {
      if (i) morceaux.push({ texte: i === phrases.length - 1 ? ' et ' : ', ' });
      morceaux.push(...p);
    });
    morceaux.push({ texte: '.' });
    // A capital letter at the start of each sentence
    const premier = morceaux.findIndex((m, i) => i === 0 || morceaux[i - 1].texte.endsWith('. '));
    if (premier >= 0 && !morceaux[premier].nom) morceaux[premier] = { ...morceaux[premier], texte: morceaux[premier].texte.charAt(0).toUpperCase() + morceaux[premier].texte.slice(1) };
    const apres = morceaux.findIndex((m, i) => i > 0 && morceaux[i - 1].texte.endsWith('. '));
    if (apres > 0 && !morceaux[apres].nom) morceaux[apres] = { ...morceaux[apres], texte: morceaux[apres].texte.charAt(0).toUpperCase() + morceaux[apres].texte.slice(1) };
    return morceaux;
  });

  /** Maison: few rooms, no search nor filters; one bâtiment, no section titles. */
  protected readonly avecFiltres = computed(() => this.panneau() || this.toutes().length > 12);
  protected readonly plusieursBatiments = computed(() => this.store.batiments().length > 1);

  protected readonly vide = computed(() => this.store.arbre() != null && this.toutes().length === 0);
  protected readonly aucunResultat = computed(() => this.toutes().length > 0 && this.favoris().length === 0 && this.groupes().length === 0);
  protected readonly enAttente = computed(() => this.store.arbre() == null);

  protected readonly SANS_BATIMENT = SANS_BATIMENT;
  protected readonly pluriel = pluriel;

  async ngOnInit(): Promise<void> {
    try {
      await this.store.charger(this.store.arbre() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les salles', messageErreur(e));
    }
    // The curves come in a second request, so the page shows without waiting for them; kept
    // ones are already there (and don't draw themselves again)
    const gardees = this.tendances();
    void this.chargerTendances(false).then(() => this.courbesNouvelles.set(this.tendances() !== gardees));
    this.minuterie = setInterval(() => void this.rafraichir(true), SONDAGE);
  }

  ngOnDestroy(): void {
    clearInterval(this.minuterie);
  }

  /** "Actualiser": unlike the poll, also redraws the curves. */
  protected async actualiser(): Promise<void> {
    this.tendancesCalculees = 0;
    await this.rafraichir(false);
  }

  private async rafraichir(discret: boolean): Promise<void> {
    try {
      await this.store.charger(discret);
      this.courbesNouvelles.set(false);
      await this.chargerTendances(discret);
    } catch (e) {
      if (!discret) this.toasts.error('Actualisation impossible', messageErreur(e));
    }
  }

  /** Average curve of each salle over the last 24 h: read again every few minutes, not on every poll. */
  private async chargerTendances(discret: boolean): Promise<void> {
    const salles = this.store.salles();
    const connues = this.tendances();
    const toutesConnues = !!connues && salles.every((s) => connues.has(s.id));
    if (toutesConnues && Date.now() - this.tendancesCalculees < VALIDITE_TENDANCES) {
      return;
    }
    const fin = new Date();
    const debut = new Date(fin.getTime() - PERIODE_TENDANCE);
    const m = new Map<number, Sparkline | null>();
    try {
      // At most 200 elements per request (server limit)
      for (let i = 0; i < salles.length; i += 200) {
        const lot = salles.slice(i, i + 200);
        const r = await firstValueFrom(this.climat.moyennes(lot.map((s) => s.id), debut, fin, discret));
        for (const s of lot) m.set(s.id, sparkline(points(r[String(s.id)] ?? []), debut.getTime(), fin.getTime(), s.consigne?.value ?? null));
      }
      this.tendances.set(m);
      this.tendancesCalculees = Date.now();
      this.cache.ecrire(CLE_TENDANCES, m);
    } catch {
      if (!this.tendances()) this.tendances.set(new Map(salles.map((s) => [s.id, null])));
    }
  }

  protected async basculerFavori(id: number): Promise<void> {
    const n = this.store.parId().get(id);
    if (!n) return;
    const favori = !n.favori;
    // The card flies to the favourites (or back to its building), its star spins
    this.flip.animer(() => this.store.remplacer({ ...n, favori }));
    this.plateforme.vibrer();
    try {
      await firstValueFrom(favori ? this.favorisApi.ajouter(id) : this.favorisApi.retirer(id));
    } catch (e) {
      this.flip.animer(() => this.store.remplacer({ ...n, favori: !favori }));
      this.toasts.error('Impossible de modifier les favoris', messageErreur(e));
    }
  }

  /** Summary chip: shows only the salles in [etat]; a second click shows them all again. */
  protected basculerEtat(etat: EtatSalle): void {
    this.flip.animer(() => this.etatFiltre.update((e) => (e === etat ? null : etat)));
  }

  protected choisirBatiment(v: string): void {
    this.flip.animer(() => this.batimentId.set(v === '' ? null : Number(v)));
  }

  protected chercher(v: string): void {
    this.flip.animer(() => this.recherche.set(v));
  }

  protected effacerFiltres(): void {
    this.flip.animer(() => {
      this.recherche.set('');
      this.batimentId.set(null);
      this.etatFiltre.set(null);
      this.plage.bas.set(null);
      this.plage.haut.set(null);
    });
  }

  protected replie(cle: string): boolean {
    return this.replies().has(cle);
  }

  /** Each section folds and unfolds from its title; kept on this device. */
  protected basculerSection(cle: string): void {
    this.replies.update((s) => {
      const r = new Set(s);
      if (r.has(cle)) r.delete(cle);
      else r.add(cle);
      ecrireSections(r);
      return r;
    });
  }

  protected readonly ETATS = ETATS;
}

function points(l: Point[]): PointT[] {
  return l.filter((p) => p.value != null).map((p) => ({ t: temps(p.date), v: p.value! })).filter((p) => !isNaN(p.t));
}

function lireSections(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLE_SECTIONS) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function ecrireSections(s: Set<string>): void {
  try {
    localStorage.setItem(CLE_SECTIONS, JSON.stringify([...s]));
  } catch {
    /* private browsing */
  }
}
