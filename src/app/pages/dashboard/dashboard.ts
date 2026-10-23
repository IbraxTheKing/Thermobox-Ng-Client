import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { AvisMajService } from '../../core/avis-maj';
import { PointT, Sparkline, sparkline } from '../../core/courbes';
import { temps } from '../../core/dates';
import { ETATS, EtatSalle, ORDRE_ETATS, compte, etatDe } from '../../core/etat';
import { ToastService } from '../../core/messages';
import { PlateformeService } from '../../core/plateforme';
import { correspond, normaliser, parNom, pluriel } from '../../core/texte';
import { UniteService } from '../../core/unite';
import { Noeud, Point } from '../../models/models';
import { ArbreStore } from '../../services/arbre.store';
import { ClimatService } from '../../services/climat.service';
import { FavoriService } from '../../services/favori.service';
import { TbSalleCard } from './salle-card';
import { SalleResume } from './resume';

/** The salles of a bâtiment (or those without bâtiment when [batiment] is null). */
interface GroupeBatiment {
  batiment: Noeud | null;
  nom: string;
  /** Key of the section in the folded sections (see replie). */
  cle: string;
  moyenne: number | null;
  salles: SalleResume[];
}

const SANS_BATIMENT = -1;
const CLE_SECTIONS = 'tb-sections';
const PERIODE_TENDANCE = 24 * 3_600_000;
const VALIDITE_TENDANCES = 5 * 60_000;
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

  // Filters
  protected readonly recherche = signal('');
  protected readonly etatFiltre = signal<EtatSalle | null>(null);
  protected readonly batimentId = signal<number | null>(null);

  /** Curves of the last 24 h by salle: undefined while they load, null without enough measures. */
  private readonly tendances = signal<Map<number, Sparkline | null> | null>(null);
  private tendancesCalculees = 0;
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
      .sort(parNom((r) => r.salle.name));
  });

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
        return { batiment, nom: batiment?.name ?? 'Sans bâtiment', cle: id != null ? `b${id}` : 'sans', moyenne: moyennes.get(id) ?? null, salles };
      })
      .sort((a, b) => Number(a.batiment == null) - Number(b.batiment == null) || normaliser(a.nom).localeCompare(normaliser(b.nom), 'fr'));
  });

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
    // The curves come in a second request, so the page shows without waiting for them
    void this.chargerTendances(false).then(() => this.courbesNouvelles.set(true));
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
    } catch {
      if (!this.tendances()) this.tendances.set(new Map(salles.map((s) => [s.id, null])));
    }
  }

  protected async basculerFavori(id: number): Promise<void> {
    const n = this.store.parId().get(id);
    if (!n) return;
    const favori = !n.favori;
    this.store.remplacer({ ...n, favori });
    this.plateforme.vibrer();
    try {
      await firstValueFrom(favori ? this.favorisApi.ajouter(id) : this.favorisApi.retirer(id));
    } catch (e) {
      this.store.remplacer({ ...n, favori: !favori });
      this.toasts.error('Impossible de modifier les favoris', messageErreur(e));
    }
  }

  /** Summary chip: shows only the salles in [etat]; a second click shows them all again. */
  protected basculerEtat(etat: EtatSalle): void {
    this.etatFiltre.update((e) => (e === etat ? null : etat));
  }

  protected choisirBatiment(v: string): void {
    this.batimentId.set(v === '' ? null : Number(v));
  }

  protected effacerFiltres(): void {
    this.recherche.set('');
    this.batimentId.set(null);
    this.etatFiltre.set(null);
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
