import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { PreferencesService } from '../../core/preferences';
import { UniteService } from '../../core/unite';
import { Noeud, SalleKind } from '../../models/models';
import { ArbreStore, ENFANTS, ICONES, LIBELLES } from '../../services/arbre.store';
import { HierarchieService } from '../../services/hierarchie.service';
import { SalleService } from '../../services/salle.service';
import { TbSheet } from '../../ui/sheet';
import { ElementDialog } from './element-dialog';

/**
 * Bâtiments et salles (salles.xhtml): the whole structure. On wide screens a tree where an ADMIN
 * drags an element onto another to move it; on phones one level at a time, like a file browser,
 * with the actions of an element behind ⋮.
 */
@Component({
  selector: 'tb-salles',
  imports: [RouterLink, NgTemplateOutlet, TbSheet, ElementDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './salles.html',
})
export class SallesPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(ArbreStore);
  protected readonly unite = inject(UniteService);
  private readonly prefs = inject(PreferencesService);
  /** « Maison »: the rooms of the house. */
  protected readonly maison = computed(() => this.prefs.style() !== 'panneau');
  private readonly api = inject(HierarchieService);
  private readonly salles = inject(SalleService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly dialogue = viewChild.required(ElementDialog);

  protected readonly libelles = LIBELLES;
  protected readonly icones = ICONES;
  protected readonly enfantsPossibles = ENFANTS;

  /** Elements folded in the tree (salles start folded: their boxes are below). */
  protected readonly replies = signal<Set<number>>(new Set());
  private initialise = false;

  /** Phones: the bâtiment / étage whose content is listed (null: the top level). */
  protected readonly dossierId = signal<number | null>(null);
  /** Element whose actions are open in the sheet (phones). */
  protected readonly selection = signal<Noeud | null>(null);

  // Drag and drop (ADMIN, mouse)
  protected readonly glisse = signal<number | null>(null);
  protected readonly survol = signal<number | 'racine' | null>(null);

  private minuterie?: ReturnType<typeof setInterval>;

  protected readonly dossier = computed(() => {
    const id = this.dossierId();
    return id != null ? (this.store.parId().get(id) ?? null) : null;
  });
  protected readonly contenu = computed(() => this.store.enfants().get(this.dossierId() ?? -1) ?? []);
  protected readonly chemin = computed(() => {
    const d = this.dossier();
    return d ? [...this.store.chemin(d.id), d] : [];
  });

  async ngOnInit(): Promise<void> {
    try {
      await this.store.charger(this.store.arbre() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les bâtiments et salles', messageErreur(e));
    }
    this.initialiserReplies();
    this.minuterie = setInterval(() => void this.store.charger(true).catch(() => undefined), 30_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.minuterie);
  }

  private initialiserReplies(): void {
    if (this.initialise || !this.store.arbre()) return;
    this.initialise = true;
    this.replies.set(new Set(this.store.noeuds().filter((n) => n.kind === 'SALLE').map((n) => n.id)));
  }

  protected icone(n: Noeud): string {
    return ICONES[n.kind];
  }

  protected libelle(n: Noeud): string {
    return LIBELLES[n.kind];
  }

  /** Kinds an element may contain (the first is offered by « Ajouter dedans »). */
  protected enfantsDe(n: Noeud): SalleKind[] {
    return ENFANTS[n.kind];
  }

  protected enfants(id: number): Noeud[] {
    return this.store.enfants().get(id) ?? [];
  }

  protected replie(id: number): boolean {
    return this.replies().has(id);
  }

  protected basculer(id: number): void {
    this.replies.update((s) => {
      const r = new Set(s);
      if (r.has(id)) r.delete(id);
      else r.add(id);
      return r;
    });
  }

  /** Bâtiments and étages open in the list; salles and boxes open their page. */
  protected estDossier(n: Noeud): boolean {
    return n.kind === 'BATIMENT' || n.kind === 'ETAGE';
  }

  protected ouvrir(id: number | null): void {
    this.dossierId.set(id);
    scrollTo({ top: 0 });
  }

  protected remonter(): void {
    this.dossierId.set(this.dossier()?.parentId ?? null);
  }

  protected choisir(n: Noeud): void {
    this.selection.set(n);
  }

  // ---------------------------------------------------------------- structure (ADMIN)

  protected creer(kind: SalleKind, parent: Noeud | null): void {
    this.selection.set(null);
    this.dialogue().ouvrir({ kind, parentId: parent?.id ?? null });
  }

  protected modifier(n: Noeud): void {
    this.selection.set(null);
    this.dialogue().ouvrir({ element: n, kind: n.kind, parentId: n.parentId });
  }

  protected async apresEnregistrement(): Promise<void> {
    await this.store.charger().catch(() => undefined);
  }

  protected async detacher(n: Noeud): Promise<void> {
    this.selection.set(null);
    try {
      await firstValueFrom(this.api.deplacer(n.id, null));
      this.toasts.info(`« ${n.name} » n'est plus rattaché(e)`);
    } catch (e) {
      this.toasts.error('Détachement impossible', messageErreur(e));
    }
    await this.store.charger().catch(() => undefined);
  }

  protected async supprimer(n: Noeud): Promise<void> {
    this.selection.set(null);
    const ok = await this.confirm.demander(`Supprimer « ${n.name} »`, "Son historique est supprimé ; ce qu'il contient est gardé mais n'est plus rattaché.", {
      confirmer: 'Supprimer',
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.salles.remove(n.id));
      this.toasts.info(`« ${n.name} » supprimé(e)`);
      if (this.dossierId() === n.id) this.dossierId.set(n.parentId);
    } catch (e) {
      this.toasts.error('Suppression impossible', messageErreur(e));
    }
    await this.store.charger().catch(() => undefined);
  }

  // ---------------------------------------------------------------- drag and drop (ADMIN, wide screens)

  protected debutGlisse(e: DragEvent, n: Noeud): void {
    if (!this.auth.admin()) return;
    this.glisse.set(n.id);
    e.dataTransfer?.setData('text/plain', String(n.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected finGlisse(): void {
    this.glisse.set(null);
    this.survol.set(null);
  }

  protected surSurvol(e: DragEvent, cible: Noeud | 'racine'): void {
    const id = this.glisse();
    if (id == null) return;
    if (cible !== 'racine' && (cible.id === id || this.store.descendants(id).some((d) => d.id === cible.id))) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.survol.set(cible === 'racine' ? 'racine' : cible.id);
  }

  /**
   * Moves the element on the server first: a refused move never shows. Dropping on the top zone
   * detaches the element.
   */
  protected async deposer(e: DragEvent, cible: Noeud | null): Promise<void> {
    e.preventDefault();
    const id = this.glisse();
    this.finGlisse();
    const element = id != null ? this.store.parId().get(id) : null;
    if (!element || element.parentId === (cible?.id ?? null)) return;
    try {
      await firstValueFrom(this.api.deplacer(element.id, cible?.id ?? null));
      this.toasts.info(cible ? `« ${element.name} » déplacé(e) dans « ${cible.name} »` : `« ${element.name} » n'est plus rattaché(e)`);
      if (cible) this.replies.update((s) => new Set([...s].filter((x) => x !== cible.id)));
    } catch (err) {
      this.toasts.error('Déplacement impossible', messageErreur(err));
    }
    await this.store.charger().catch(() => undefined);
  }
}
