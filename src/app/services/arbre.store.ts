import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../core/api.config';
import { Arbre, Noeud, SalleKind } from '../models/models';
import { normaliser } from '../core/texte';
import { HierarchieService } from './hierarchie.service';

/** Kinds that may contain a kind (SalleKind.parentKinds of the server). */
export const PARENTS: Record<SalleKind, SalleKind[]> = {
  BATIMENT: [],
  ETAGE: ['BATIMENT'],
  SALLE: ['ETAGE', 'BATIMENT'],
  BOITIER: ['SALLE'],
};

/** Kinds a kind may contain. */
export const ENFANTS: Record<SalleKind, SalleKind[]> = {
  BATIMENT: ['ETAGE', 'SALLE'],
  ETAGE: ['SALLE'],
  SALLE: ['BOITIER'],
  BOITIER: [],
};

export const LIBELLES: Record<SalleKind, string> = {
  BATIMENT: 'Bâtiment',
  ETAGE: 'Étage',
  SALLE: 'Salle',
  BOITIER: 'Boîtier',
};

export const AVEC_ARTICLE: Record<SalleKind, string> = {
  BATIMENT: 'un bâtiment',
  ETAGE: 'un étage',
  SALLE: 'une salle',
  BOITIER: 'un boîtier',
};

export const ICONES: Record<SalleKind, string> = {
  BATIMENT: 'pi-building',
  ETAGE: 'pi-server',
  SALLE: 'pi-home',
  BOITIER: 'pi-wifi',
};

export const ORDRE_KINDS: SalleKind[] = ['BATIMENT', 'ETAGE', 'SALLE', 'BOITIER'];

/**
 * The bâtiment → étage → salle → boîtier tree as the logged-in user sees it
 * (GET /api/hierarchie/arbre), shared by the pages: dashboard, salles, gestion, mesures, and the
 * lists of possible parents. Reloaded by each page when it opens, and by the 30-second polls.
 */
@Injectable({ providedIn: 'root' })
export class ArbreStore {
  private readonly api = inject(HierarchieService);

  readonly arbre = signal<Arbre | null>(null);
  readonly erreur = signal<string | null>(null);
  readonly chargement = signal(false);

  readonly noeuds = computed(() => this.arbre()?.noeuds ?? []);
  readonly tout = computed(() => this.arbre()?.tout ?? false);

  readonly parId = computed(() => new Map(this.noeuds().map((n) => [n.id, n])));

  /** Children of each element (key -1: the top level), in the server's order (kind, name). */
  readonly enfants = computed(() => {
    const parId = this.parId();
    const m = new Map<number, Noeud[]>();
    for (const n of this.noeuds()) {
      // A parent the user can't see (shouldn't happen): shown at the top level
      const p = n.parentId != null && parId.has(n.parentId) ? n.parentId : -1;
      const l = m.get(p) ?? [];
      l.push(n);
      m.set(p, l);
    }
    return m;
  });

  readonly racines = computed(() => this.enfants().get(-1) ?? []);
  readonly batiments = computed(() => this.noeuds().filter((n) => n.kind === 'BATIMENT'));

  /** Salles (not étages, bâtiments or boxes) whose data the user may see: the dashboard cards. */
  readonly salles = computed(() => this.noeuds().filter((n) => n.kind === 'SALLE' && n.accessible));

  /** Boxes that measure but belong to no salle (ADMIN, GESTIONNAIRE). */
  readonly boitiersNonRattaches = computed(() => this.noeuds().filter((n) => n.kind === 'BOITIER' && !n.rattache).length);

  async charger(discret = false): Promise<void> {
    if (!discret) this.chargement.set(true);
    try {
      const a = await firstValueFrom(this.api.arbre(discret));
      this.arbre.set(a);
      this.erreur.set(null);
    } catch (e) {
      this.erreur.set(messageErreur(e, "Impossible de charger les bâtiments et salles"));
      if (!discret) throw e;
    } finally {
      this.chargement.set(false);
    }
  }

  /** Changes one element in place (favourite toggled, renamed…) until the next reload. */
  remplacer(n: Noeud): void {
    const a = this.arbre();
    if (!a) return;
    this.arbre.set({ ...a, noeuds: a.noeuds.map((x) => (x.id === n.id ? n : x)) });
  }

  /** Ancestors of [id], from the bâtiment down to its direct parent. */
  chemin(id: number): Noeud[] {
    const parId = this.parId();
    const r: Noeud[] = [];
    let courant = parId.get(id)?.parentId;
    while (courant != null && r.length < 6) {
      const p = parId.get(courant);
      if (!p) break;
      r.unshift(p);
      courant = p.parentId;
    }
    return r;
  }

  /** « Bâtiment A › Étage 1 » */
  cheminTexte(id: number): string {
    return this.chemin(id)
      .map((n) => n.name ?? '')
      .join(' › ');
  }

  /** The bâtiment [id] is in, if any. */
  batimentDe(id: number): Noeud | null {
    return this.chemin(id).find((n) => n.kind === 'BATIMENT') ?? null;
  }

  /** Every element under [id], at any depth. */
  descendants(id: number): Noeud[] {
    const r: Noeud[] = [];
    const parcourir = (p: number, profondeur: number) => {
      if (profondeur > 5) return;
      for (const e of this.enfants().get(p) ?? []) {
        r.push(e);
        parcourir(e.id, profondeur + 1);
      }
    };
    parcourir(id, 0);
    return r;
  }

  /** Where an element of [kind] can go (sorted by kind then name). */
  parentsPossibles(kind: SalleKind, sauf?: number): Noeud[] {
    const exclus = new Set(sauf != null ? [sauf, ...this.descendants(sauf).map((n) => n.id)] : []);
    return this.noeuds()
      .filter((n) => PARENTS[kind].includes(n.kind) && !exclus.has(n.id))
      .sort((a, b) => ORDRE_KINDS.indexOf(a.kind) - ORDRE_KINDS.indexOf(b.kind) || normaliser(a.name).localeCompare(normaliser(b.name), 'fr'));
  }

  /** « Étage 1 (Étage, Bâtiment A) » for a list of parents. */
  libelle(n: Noeud): string {
    const chemin = this.cheminTexte(n.id);
    return chemin ? `${n.name} (${LIBELLES[n.kind]}, ${chemin})` : `${n.name} (${LIBELLES[n.kind]})`;
  }

  vider(): void {
    this.arbre.set(null);
  }
}
