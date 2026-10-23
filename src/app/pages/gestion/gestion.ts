import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { EtatSalle, etatDe, horsConsigne } from '../../core/etat';
import { ConfirmService, ToastService } from '../../core/messages';
import { FlipService } from '../../core/flip';
import { PlateformeService } from '../../core/plateforme';
import { normaliser } from '../../core/texte';
import { TransitionsService } from '../../core/transitions';
import { UniteService, lireNombre } from '../../core/unite';
import { Noeud, SalleKind } from '../../models/models';
import { ArbreStore, ICONES, LIBELLES, ORDRE_KINDS, PARENTS } from '../../services/arbre.store';
import { ClimatService } from '../../services/climat.service';
import { DroitsStore } from '../../services/droits.store';
import { GroupeService } from '../../services/groupe.service';
import { HierarchieService } from '../../services/hierarchie.service';
import { SalleService } from '../../services/salle.service';
import { UserService } from '../../services/user.service';
import { Option, TbChoixMultiple } from '../../ui/choix-multiple';
import { TbStepper, TbSwitch } from '../../ui/controles';
import { TbSheet } from '../../ui/sheet';
import { ElementDialog } from '../salles/element-dialog';
import { DroitsTab } from './droits';

/** One row: an element with its place, temperature and consigne (Celsius). */
interface Ligne {
  n: Noeud;
  chemin: string;
  etat: EtatSalle;
  boitier: boolean;
  /** Phones, tree order: depth under the top level, and how many elements it contains. */
  profondeur?: number;
  enfants?: number;
}

const PAR_PAGE = 50;

/**
 * Gestion des salles (gestion.xhtml), GESTIONNAIRE and ADMIN: every bâtiment, étage, salle and box
 * the user may see in one table. A GESTIONNAIRE sets consignes, one by one or for a selection; an
 * ADMIN also creates, renames, moves, deletes and gives accesses, and has the « Utilisateurs et
 * groupes » tab.
 *
 * On a phone, a list instead of the table: a row opens what can be done with its element (its
 * consigne first), « Sélectionner » (or holding a row) acts on several at once, as in native apps.
 */
@Component({
  selector: 'tb-gestion',
  imports: [RouterLink, TbSheet, TbSwitch, TbStepper, TbChoixMultiple, ElementDialog, DroitsTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gestion.html',
})
export class GestionPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(ArbreStore);
  protected readonly unite = inject(UniteService);
  private readonly climat = inject(ClimatService);
  private readonly hierarchie = inject(HierarchieService);
  private readonly salles = inject(SalleService);
  private readonly droits = inject(DroitsStore);
  private readonly users = inject(UserService);
  private readonly groupesApi = inject(GroupeService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly plateforme = inject(PlateformeService);
  private readonly flip = inject(FlipService);
  private readonly transitions = inject(TransitionsService);

  /** Phone-sized screen: list, sheets, selection mode. */
  protected readonly tel = this.plateforme.telephone;

  private readonly dialogue = viewChild(ElementDialog);
  private readonly ongletDroits = viewChild(DroitsTab);

  protected readonly icones = ICONES;
  protected readonly libelles = LIBELLES;

  /** "salles" or "droits" (ADMIN: users and groups). */
  protected readonly onglet = signal<'salles' | 'droits'>('salles');

  // Filters
  protected readonly recherche = signal('');
  protected readonly type = signal<SalleKind | null>(null);
  protected readonly seulementATraiter = signal(false);
  protected readonly page = signal(0);

  protected readonly selection = signal<Set<number>>(new Set());
  /** Consigne typed on each row, in the unit of the Préférences page. */
  protected readonly saisies = signal<Map<number, string>>(new Map());
  protected readonly envoiEnCours = signal<number | null>(null);

  protected readonly types = computed(() => ORDRE_KINDS.filter((k) => k !== 'BOITIER' || this.auth.voitBoitiers()));

  protected readonly lignes = computed<Ligne[]>(() =>
    this.store
      .noeuds()
      .filter((n) => n.accessible && (n.kind !== 'BOITIER' || this.auth.voitBoitiers()))
      .map((n) => ({ n, chemin: this.store.cheminTexte(n.id), etat: etatDe(n.temperature, n.kind === 'BOITIER' ? null : n.consigne?.value), boitier: n.kind === 'BOITIER' }))
      .sort((a, b) => normaliser(a.chemin).localeCompare(normaliser(b.chemin), 'fr') || ORDRE_KINDS.indexOf(a.n.kind) - ORDRE_KINDS.indexOf(b.n.kind) || normaliser(a.n.name).localeCompare(normaliser(b.n.name), 'fr')),
  );

  /** Off its consigne, or a box not attached. */
  protected aTraiter(l: Ligne): boolean {
    return horsConsigne(l.etat) || (l.boitier && !l.n.rattache);
  }

  protected readonly visibles = computed(() => {
    const mot = normaliser(this.recherche().trim());
    return this.lignes().filter(
      (l) =>
        (this.type() == null || l.n.kind === this.type()) &&
        (!mot || normaliser(`${l.n.name} ${l.chemin}`).includes(mot)) &&
        (!this.seulementATraiter() || this.aTraiter(l)),
    );
  });
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.visibles().length / PAR_PAGE)));
  protected readonly numerosPages = computed(() => Array.from({ length: this.pages() }, (_, i) => i));
  protected readonly lignesPage = computed(() => {
    const p = Math.min(this.page(), this.pages() - 1);
    return this.visibles().slice(p * PAR_PAGE, p * PAR_PAGE + PAR_PAGE);
  });
  protected readonly lignesSelection = computed(() => this.lignes().filter((l) => this.selection().has(l.n.id)));
  protected readonly toutCoche = computed(() => this.lignesPage().length > 0 && this.lignesPage().every((l) => this.selection().has(l.n.id)));

  protected nombre(k: SalleKind | null): number {
    return k == null ? this.lignes().length : this.lignes().filter((l) => l.n.kind === k).length;
  }
  protected readonly nombreATraiter = computed(() => this.lignes().filter((l) => this.aTraiter(l)).length);

  constructor() {
    // « À traiter »: the page turns to the colour of what is to be done, as the JSF one
    effect(() => this.transitions.definirTon(this.seulementATraiter() && this.onglet() === 'salles' ? 'chauffe' : null));
    inject(DestroyRef).onDestroy(() => this.transitions.definirTon(null));
    // Leaving the phone layout (rotation, wider window): no selection mode left behind
    effect(() => {
      if (!this.tel()) this.modeSelection.set(false);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.store.charger(this.store.arbre() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les éléments', messageErreur(e));
    }
  }

  protected ouvrirOnglet(o: 'salles' | 'droits'): void {
    this.onglet.set(o === 'droits' && this.auth.admin() ? 'droits' : 'salles');
  }

  // ---------------------------------------------------------------- phones

  protected readonly modeSelection = signal(false);
  /** Rows shown on a phone: 50 more at a time. */
  protected readonly limiteTel = signal(50);

  /**
   * Phones, nothing searched or filtered: the elements in the order of the tree, each one under
   * the one that contains it (bâtiment → étage → salle → boîtier), indented, and folded on demand.
   * A flat list sorted by place showed a bâtiment's étages after the other bâtiments.
   */
  protected readonly enArbre = computed(() => this.tel() && !this.recherche().trim() && this.type() == null && !this.seulementATraiter());
  /** Folded elements (their content hidden). */
  protected readonly plies = signal<Set<number>>(new Set());
  protected readonly lignesArbre = computed<Ligne[]>(() => {
    const parId = new Map(this.lignes().map((l) => [l.n.id, l]));
    const enfants = this.store.enfants();
    const plies = this.plies();
    const res: Ligne[] = [];
    const compter = (id: number): number => (enfants.get(id) ?? []).reduce((n, c) => n + (parId.has(c.id) ? 1 : 0) + (parId.has(c.id) ? 0 : compter(c.id)), 0);
    const visiter = (n: Noeud, profondeur: number) => {
      const l = parId.get(n.id);
      // An element the user may not manage (a bâtiment around their salles): its content shown at its place
      if (l) res.push({ ...l, profondeur, enfants: compter(n.id) });
      if (l && plies.has(n.id)) return;
      for (const c of enfants.get(n.id) ?? []) visiter(c, l ? profondeur + 1 : profondeur);
    };
    for (const r of this.store.racines()) visiter(r, 0);
    return res;
  });
  /** What the phone list shows. */
  protected readonly lignesListe = computed(() => (this.enArbre() ? this.lignesArbre() : this.visibles()));
  protected readonly lignesTel = computed(() => this.lignesListe().slice(0, this.limiteTel()));

  protected plier(l: Ligne, ev: Event): void {
    ev.stopPropagation();
    this.flip.animer(() =>
      this.plies.update((s) => {
        const t = new Set(s);
        if (t.has(l.n.id)) t.delete(l.n.id);
        else t.add(l.n.id);
        return t;
      }),
    );
  }
  /** Actions of the ticked rows: on a phone, only in selection mode. */
  protected readonly barreVisible = computed(() => this.selection().size > 0 && (!this.tel() || this.modeSelection()));

  protected basculerModeSelection(): void {
    this.modeSelection.update((m) => !m);
    if (!this.modeSelection()) this.selection.set(new Set());
    this.plateforme.vibrer();
  }

  /** A row: ticked or not in selection mode, else the sheet of its element. */
  protected toucherLigne(l: Ligne): void {
    if (this.appuiLong) {
      this.appuiLong = false;
      return;
    }
    if (this.modeSelection()) {
      this.cocher(l.n.id, !this.selection().has(l.n.id));
      this.plateforme.vibrer();
      return;
    }
    this.ouvrirFeuille(l);
  }

  private minuterieAppui?: ReturnType<typeof setTimeout>;
  private appuiLong = false;

  /** Holding a row: selection mode, starting with it. */
  protected debutAppuiLong(l: Ligne, e: PointerEvent): void {
    if (this.modeSelection() || e.pointerType === 'mouse') return;
    clearTimeout(this.minuterieAppui);
    const x = e.clientX;
    const y = e.clientY;
    const cible = e.currentTarget as HTMLElement;
    const annuler = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.type === 'pointermove' && Math.hypot(ev.clientX - x, ev.clientY - y) < 10) return;
      clearTimeout(this.minuterieAppui);
      for (const t of ['pointerup', 'pointercancel', 'pointermove']) cible.removeEventListener(t, annuler);
    };
    for (const t of ['pointerup', 'pointercancel', 'pointermove']) cible.addEventListener(t, annuler);
    this.minuterieAppui = setTimeout(() => {
      annuler(new Event('fin'));
      this.appuiLong = true;
      setTimeout(() => (this.appuiLong = false), 600);
      this.modeSelection.set(true);
      this.selection.set(new Set([l.n.id]));
      this.plateforme.vibrer(true);
    }, 480);
  }

  // Sheet of one element
  protected readonly feuilleOuverte = signal(false);
  protected readonly enFeuille = signal<Ligne | null>(null);
  /** In the unit of the Préférences page. */
  protected readonly consigneFeuille = signal<number | null>(null);

  private ouvrirFeuille(l: Ligne): void {
    this.enFeuille.set(l);
    const c = l.n.consigne?.value;
    this.consigneFeuille.set(c == null ? null : Math.round(this.unite.depuisCelsius(c) * 10) / 10);
    this.forcer.set(false);
    this.feuilleOuverte.set(true);
  }

  protected async envoyerFeuille(e: Event, l: Ligne): Promise<void> {
    e.preventDefault();
    const v = this.consigneFeuille();
    if (v == null) {
      this.toasts.warn('Indique la consigne à envoyer');
      return;
    }
    this.envoiEnCours.set(l.n.id);
    const ok = await this.envoyer([l], v, this.forcer());
    this.envoiEnCours.set(null);
    if (ok) this.feuilleOuverte.set(false);
  }

  /** An action of the sheet, done as for a selection of this element alone. */
  protected depuisFeuille(l: Ligne, action: 'modifier' | 'acces' | 'supprimer'): void {
    this.feuilleOuverte.set(false);
    if (action === 'modifier') this.modifier(l);
    else if (action === 'supprimer') void this.supprimer(l);
    else {
      this.selection.set(new Set([l.n.id]));
      void this.ouvrirAcces();
    }
  }

  protected filtrerType(k: SalleKind | null): void {
    this.flip.animer(() => {
      this.type.update((t) => (t === k ? null : k));
      // "Tout": every element again
      if (k == null) this.seulementATraiter.set(false);
      this.page.set(0);
    });
  }

  protected basculerATraiter(): void {
    this.flip.animer(() => {
      this.seulementATraiter.update((v) => !v);
      this.page.set(0);
    });
  }

  protected chercher(v: string): void {
    this.flip.animer(() => {
      this.recherche.set(v);
      this.page.set(0);
    });
  }

  // ---------------------------------------------------------------- selection

  protected cocher(id: number, coche: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      if (coche) r.add(id);
      else r.delete(id);
      return r;
    });
  }

  protected toutCocher(coche: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      for (const l of this.lignesPage()) {
        if (coche) r.add(l.n.id);
        else r.delete(l.n.id);
      }
      return r;
    });
  }

  protected toutDecocher(): void {
    this.selection.set(new Set());
  }

  // ---------------------------------------------------------------- consignes (GESTIONNAIRE)

  protected saisir(id: number, v: string): void {
    this.saisies.update((m) => new Map(m).set(id, v));
  }

  /** Consigne of one row, typed in its field. */
  protected async appliquer(l: Ligne): Promise<void> {
    const saisie = lireNombre(this.saisies().get(l.n.id));
    if (saisie == null) {
      this.toasts.warn(`Indique une consigne pour « ${l.n.name} »`);
      return;
    }
    this.envoiEnCours.set(l.n.id);
    if (await this.envoyer([l], saisie, false)) {
      this.saisies.update((m) => {
        const r = new Map(m);
        r.delete(l.n.id);
        return r;
      });
    }
    this.envoiEnCours.set(null);
  }

  // Consigne of the selection (dialog)
  protected readonly dlgConsigne = signal(false);
  protected readonly consigneGroupe = signal('');
  protected readonly forcer = signal(false);

  protected async appliquerSelection(e: Event): Promise<void> {
    e.preventDefault();
    const v = lireNombre(this.consigneGroupe());
    if (v == null) {
      this.toasts.warn('Indique la consigne à envoyer');
      return;
    }
    if (await this.envoyer(this.lignesSelection(), v, this.forcer())) {
      this.consigneGroupe.set('');
      this.forcer.set(false);
      this.dlgConsigne.set(false);
    }
  }

  private async envoyer(cibles: Ligne[], saisie: number, forcer: boolean): Promise<boolean> {
    const celsius = this.unite.saisieVersCelsius(saisie);
    const elements = cibles.filter((l) => !l.boitier);
    if (!elements.length) {
      this.toasts.warn('Rien à régler', 'Une consigne se règle sur un bâtiment, un étage ou une salle.');
      return false;
    }
    const refusees: string[] = [];
    let boitiers = 0;
    for (const l of elements) {
      try {
        boitiers += (await firstValueFrom(this.climat.envoyerConsigne(l.n.id, celsius, forcer))).boitiers.length;
      } catch (e) {
        refusees.push(`${l.n.name} (${messageErreur(e)})`);
      }
    }
    const reussies = elements.length - refusees.length;
    const texte = `${this.unite.t(celsius)} ${this.unite.symbole()}`;
    if (reussies > 0) this.toasts.info(`Consigne de ${texte} pour ${reussies} élément(s)`, `Envoyée à ${boitiers} boîtier(s)`);
    if (refusees.length) this.toasts.error('Consigne refusée', refusees.join(', '));
    await this.store.charger(true).catch(() => undefined);
    return refusees.length === 0;
  }

  // ---------------------------------------------------------------- structure (ADMIN)

  protected nouveau(): void {
    const kind: SalleKind = this.type() && this.type() !== 'BOITIER' ? this.type()! : 'SALLE';
    const seule = this.lignesSelection().length === 1 ? this.lignesSelection()[0].n : null;
    this.dialogue()?.ouvrir({ kind, parentId: seule && PARENTS[kind].includes(seule.kind) ? seule.id : null });
  }

  protected modifier(l: Ligne): void {
    this.dialogue()?.ouvrir({ element: l.n, kind: l.n.kind, parentId: l.n.parentId });
  }

  protected async apresEnregistrement(): Promise<void> {
    await this.store.charger(true).catch(() => undefined);
  }

  // Move the selection (dialog)
  protected readonly dlgDeplacer = signal(false);
  protected readonly cibleId = signal<number | null>(null);

  /** Where the whole selection can go: allowed for every selected kind. */
  protected readonly ciblesPossibles = computed(() => {
    const sel = this.lignesSelection();
    const kinds = new Set(sel.map((l) => l.n.kind));
    const exclus = new Set(sel.flatMap((l) => [l.n.id, ...this.store.descendants(l.n.id).map((d) => d.id)]));
    return this.lignes().filter((c) => !exclus.has(c.n.id) && [...kinds].every((k) => PARENTS[k].includes(c.n.kind)));
  });

  protected libelle(l: Ligne): string {
    return l.chemin ? `${l.n.name} (${LIBELLES[l.n.kind]}, ${l.chemin})` : `${l.n.name} (${LIBELLES[l.n.kind]})`;
  }

  /** Moves the selection into the chosen element (none: detaches it). */
  protected async deplacerSelection(): Promise<void> {
    const cible = this.cibleId() != null ? this.store.parId().get(this.cibleId()!) : null;
    const refuses: string[] = [];
    const sel = this.lignesSelection();
    for (const l of sel) {
      try {
        await firstValueFrom(this.hierarchie.deplacer(l.n.id, cible?.id ?? null));
      } catch (e) {
        refuses.push(`${l.n.name} (${messageErreur(e)})`);
      }
    }
    const ok = sel.length - refuses.length;
    if (ok > 0) this.toasts.info(cible ? `${ok} élément(s) déplacé(s) dans « ${cible.name} »` : `${ok} élément(s) détaché(s)`);
    if (refuses.length) this.toasts.error('Déplacement impossible', refuses.join(', '));
    this.cibleId.set(null);
    this.dlgDeplacer.set(false);
    await this.store.charger(true).catch(() => undefined);
  }

  protected async supprimer(l: Ligne): Promise<void> {
    if (!(await this.confirm.demander('Supprimer', `Supprimer « ${l.n.name} » ? Ce qu'il contient est gardé, sans rattachement.`, { confirmer: 'Supprimer' }))) return;
    await this.supprimerTous([l]);
  }

  protected async supprimerSelection(): Promise<void> {
    const sel = this.lignesSelection();
    if (!(await this.confirm.demander('Supprimer', `Supprimer les ${sel.length} éléments sélectionnés ? Ce qu'ils contiennent est gardé, sans rattachement.`, { confirmer: 'Supprimer' }))) return;
    await this.supprimerTous(sel);
  }

  private async supprimerTous(cibles: Ligne[]): Promise<void> {
    const refuses: string[] = [];
    for (const l of cibles) {
      try {
        await firstValueFrom(this.salles.remove(l.n.id));
      } catch (e) {
        refuses.push(`${l.n.name} (${messageErreur(e)})`);
      }
    }
    const ok = cibles.length - refuses.length;
    if (ok > 0) this.toasts.info(`${ok} élément(s) supprimé(s)`);
    if (refuses.length) this.toasts.error('Suppression impossible', refuses.join(', '));
    this.selection.set(new Set());
    await this.store.charger(true).catch(() => undefined);
  }

  // ---------------------------------------------------------------- accesses of the selection (ADMIN)

  protected readonly dlgAcces = signal(false);
  protected readonly accesUsers = signal<Set<number>>(new Set());
  protected readonly accesGroupes = signal<Set<number>>(new Set());

  /** Users who can be given accesses: not the ADMINs, who see everything anyway. */
  protected readonly optionsUsers = computed<Option[]>(() =>
    this.droits.users().filter((l) => l.user.type !== 'ADMIN').map((l) => ({ id: l.user.id!, label: l.user.username })),
  );
  protected readonly optionsGroupes = computed<Option[]>(() => this.droits.groupes().map((g) => ({ id: g.id, label: g.name })));

  protected async ouvrirAcces(): Promise<void> {
    this.accesUsers.set(new Set());
    this.accesGroupes.set(new Set());
    this.dlgAcces.set(true);
    if (!this.droits.charge()) await this.droits.charger().catch((e) => this.toasts.error('Impossible de charger les utilisateurs', messageErreur(e)));
  }

  /**
   * The selected bâtiments, étages and salles (and what they contain) for the chosen users and
   * groups. A user who sees everything already has them and can't lose them (limit them first in
   * « Utilisateurs et groupes »).
   */
  protected async changerAcces(donner: boolean): Promise<void> {
    const elements = this.lignesSelection().filter((l) => !l.boitier).map((l) => l.n.id);
    if (!elements.length) {
      this.toasts.warn('Sélectionne des bâtiments, étages ou salles');
      return;
    }
    if (!this.accesUsers().size && !this.accesGroupes().size) {
      this.toasts.warn('Choisis des utilisateurs ou des groupes');
      return;
    }
    const faits: string[] = [];
    const ignores: string[] = [];
    for (const id of this.accesUsers()) {
      const l = this.droits.parId().get(id);
      if (!l) continue;
      if (l.illimite) {
        ignores.push(`${l.user.username} (voit déjà tout)`);
        continue;
      }
      const actuels = (l.acces?.elements ?? []).map((e) => e.id);
      const nouveaux = donner ? [...new Set([...actuels, ...elements])] : actuels.filter((x) => !elements.includes(x));
      try {
        await firstValueFrom(this.users.setAcces(id, true, nouveaux));
        faits.push(l.user.username);
      } catch (e) {
        ignores.push(`${l.user.username} (${messageErreur(e)})`);
      }
    }
    for (const id of this.accesGroupes()) {
      const g = this.droits.groupes().find((x) => x.id === id);
      if (!g) continue;
      const req = GroupeService.requete(g);
      req.elements = donner ? [...new Set([...req.elements, ...elements])] : req.elements.filter((x) => !elements.includes(x));
      try {
        await firstValueFrom(this.groupesApi.modifier(g.id, req));
        faits.push(`groupe ${g.name}`);
      } catch (e) {
        ignores.push(`groupe ${g.name} (${messageErreur(e)})`);
      }
    }
    if (faits.length) this.toasts.info((donner ? 'Accès donné à ' : 'Accès retiré à ') + faits.join(', '), `${elements.length} élément(s) et leur contenu`);
    if (ignores.length) this.toasts.warn('Non modifié', ignores.join(', '));
    this.dlgAcces.set(false);
    if (this.tel() && !this.modeSelection()) this.selection.set(new Set());
    await this.droits.charger().catch(() => undefined);
  }

  /** Main action of the page (header button): a new element or a new group. */
  protected nouveauGroupe(): void {
    this.ongletDroits()?.nouveauGroupe();
  }
}
