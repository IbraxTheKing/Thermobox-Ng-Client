import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { ConfirmService, ToastService } from '../../core/messages';
import { initiale } from '../../core/texte';
import { Groupe, ROLES, UserRole } from '../../models/models';
import { ArbreStore } from '../../services/arbre.store';
import { DroitsStore, LigneUser } from '../../services/droits.store';
import { GroupeService } from '../../services/groupe.service';
import { UserService } from '../../services/user.service';
import { TbArbreAcces } from '../../ui/arbre-acces';
import { Option, TbChoixMultiple } from '../../ui/choix-multiple';
import { TbSheet } from '../../ui/sheet';

/**
 * « Utilisateurs et groupes » tab of the Gestion page (ADMIN only, gestion-droits.xhtml): roles
 * and accesses of several users at once, and groups of users that give access to bâtiments, étages
 * and salles.
 */
@Component({
  selector: 'tb-droits',
  imports: [TbSheet, TbChoixMultiple, TbArbreAcces],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './droits.html',
})
export class DroitsTab implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly droits = inject(DroitsStore);
  protected readonly arbre = inject(ArbreStore);
  private readonly users = inject(UserService);
  private readonly groupesApi = inject(GroupeService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly arbreGroupe = viewChild(TbArbreAcces);

  protected readonly roles = ROLES;
  protected readonly recherche = signal('');
  protected readonly selection = signal<Set<number>>(new Set());

  protected readonly visibles = computed(() => {
    const mot = this.recherche().trim().toLowerCase();
    return this.droits.users().filter((l) => !mot || l.user.username.toLowerCase().includes(mot) || l.groupes.some((g) => g.toLowerCase().includes(mot)));
  });
  protected readonly lignesSelection = computed(() => this.droits.users().filter((l) => this.selection().has(l.user.id!)));
  protected readonly toutCoche = computed(() => this.visibles().length > 0 && this.visibles().every((l) => this.selection().has(l.user.id!)));

  protected resume = DroitsStore.resumeCourt;
  protected sansAcces = DroitsStore.sansAcces;
  protected initiale = initiale;

  async ngOnInit(): Promise<void> {
    await this.charger();
  }

  private async charger(): Promise<void> {
    try {
      await this.droits.charger();
      // Keep the selection on what still exists
      const ids = new Set(this.droits.users().map((l) => l.user.id!));
      this.selection.update((s) => new Set([...s].filter((id) => ids.has(id))));
    } catch (e) {
      this.toasts.error('Impossible de charger les utilisateurs', messageErreur(e));
    }
  }

  protected cocher(id: number, coche: boolean): void {
    this.selection.update((s) => {
      const r = new Set(s);
      if (coche) r.add(id);
      else r.delete(id);
      return r;
    });
  }

  protected toutCocher(coche: boolean): void {
    this.selection.set(coche ? new Set(this.visibles().map((l) => l.user.id!)) : new Set());
  }

  // ---------------------------------------------------------------- roles

  protected changerRole(l: LigneUser, role: string): void {
    void this.appliquerRole([l], role as UserRole);
  }

  protected readonly dlgRole = signal(false);
  protected readonly roleGroupe = signal<UserRole | null>(null);

  protected async appliquerRoleSelection(): Promise<void> {
    const role = this.roleGroupe();
    if (!role) {
      this.toasts.warn('Choisis un rôle');
      return;
    }
    await this.appliquerRole(this.lignesSelection(), role);
    this.roleGroupe.set(null);
    this.dlgRole.set(false);
  }

  private async appliquerRole(cibles: LigneUser[], role: UserRole): Promise<void> {
    let n = 0;
    const ignores: string[] = [];
    for (const l of cibles) {
      // Never lock oneself out of administration
      if (this.auth.estMoi(l.user) && role !== 'ADMIN') {
        ignores.push(`${l.user.username} (votre propre compte)`);
        continue;
      }
      if (l.user.type === role) continue;
      try {
        await firstValueFrom(this.users.update(l.user.id!, { type: role }));
        n++;
      } catch (e) {
        ignores.push(`${l.user.username} (${messageErreur(e)})`);
      }
    }
    if (n > 0) this.toasts.info(`Rôle ${role} pour ${n} utilisateur(s)`, role !== 'ADMIN' ? "Un ancien administrateur n'a plus accès à rien tant que vous ne lui en donnez pas." : null);
    if (ignores.length) this.toasts.warn('Non modifié', ignores.join(', '));
    await this.charger();
  }

  // ---------------------------------------------------------------- accesses

  /** Sees everything ([tout]) or only their accesses and groups. */
  protected async accesSelection(tout: boolean): Promise<void> {
    let n = 0;
    for (const l of this.lignesSelection().filter((x) => x.user.type !== 'ADMIN')) {
      try {
        await firstValueFrom(this.users.setAcces(l.user.id!, !tout, tout ? [] : (l.acces?.elements ?? []).map((e) => e.id)));
        n++;
      } catch (e) {
        this.toasts.error(`Accès de ${l.user.username} non modifiés`, messageErreur(e));
      }
    }
    this.toasts.info(tout ? `${n} utilisateur(s) voient tout ThermoBox` : `${n} utilisateur(s) limités à leurs accès et groupes`);
    await this.charger();
  }

  // ---------------------------------------------------------------- group membership

  protected readonly dlgMembres = signal(false);
  protected readonly groupeCibleId = signal<number | null>(null);

  protected async membres(ajouter: boolean): Promise<void> {
    const g = this.droits.groupes().find((x) => x.id === this.groupeCibleId());
    if (!g) {
      this.toasts.warn('Choisis un groupe');
      return;
    }
    const ids = this.lignesSelection().map((l) => l.user.id!);
    const req = GroupeService.requete(g);
    req.members = ajouter ? [...new Set([...req.members, ...ids])] : req.members.filter((m) => !ids.includes(m));
    try {
      await firstValueFrom(this.groupesApi.modifier(g.id, req));
      this.toasts.info(ajouter ? `${ids.length} utilisateur(s) ajouté(s) à « ${g.name} »` : `${ids.length} utilisateur(s) retiré(s) de « ${g.name} »`);
      this.dlgMembres.set(false);
    } catch (e) {
      this.toasts.error('Groupe non modifié', messageErreur(e));
    }
    await this.charger();
  }

  // ---------------------------------------------------------------- groups

  protected readonly dlgGroupe = signal(false);
  protected readonly editionId = signal<number | null>(null);
  protected readonly formNom = signal('');
  protected readonly formDescription = signal('');
  protected readonly formMembres = signal<Set<number>>(new Set());
  protected readonly formCoches = signal<Set<number>>(new Set());
  protected readonly formEnvoye = signal(false);

  protected readonly optionsMembres = computed<Option[]>(() =>
    this.droits.users().map((l) => ({ id: l.user.id!, label: l.user.username, detail: `(${l.user.type})` })),
  );

  async nouveauGroupe(): Promise<void> {
    await this.preparerArbre();
    this.editionId.set(null);
    this.formNom.set('');
    this.formDescription.set('');
    this.formMembres.set(new Set(this.selection()));
    this.formCoches.set(new Set());
    this.formEnvoye.set(false);
    this.dlgGroupe.set(true);
  }

  protected async modifierGroupe(g: Groupe): Promise<void> {
    await this.preparerArbre();
    this.editionId.set(g.id);
    this.formNom.set(g.name);
    this.formDescription.set(g.description ?? '');
    this.formMembres.set(new Set(g.members.map((m) => m.id)));
    this.formCoches.set(TbArbreAcces.cocher(this.arbre.noeuds(), g.elements.map((e) => e.id)));
    this.formEnvoye.set(false);
    this.dlgGroupe.set(true);
  }

  private async preparerArbre(): Promise<void> {
    if (!this.arbre.arbre()) await this.arbre.charger().catch(() => undefined);
  }

  protected async enregistrerGroupe(e: Event): Promise<void> {
    e.preventDefault();
    this.formEnvoye.set(true);
    const nom = this.formNom().trim();
    if (!nom) return;
    const elements = this.arbreGroupe()?.retenus() ?? [];
    const req = { name: nom, description: this.formDescription().trim() || null, members: [...this.formMembres()], elements };
    try {
      const id = this.editionId();
      const g = id != null ? await firstValueFrom(this.groupesApi.modifier(id, req)) : await firstValueFrom(this.groupesApi.creer(req));
      this.toasts.info(`Groupe « ${g.name} » enregistré`, `${req.members.length} membre(s), ${elements.length} élément(s) et leur contenu`);
      this.dlgGroupe.set(false);
      await this.charger();
    } catch (err) {
      this.toasts.error('Groupe non enregistré', messageErreur(err));
    }
  }

  protected async supprimerGroupe(g: Groupe): Promise<void> {
    if (!(await this.confirm.demander('Supprimer', `Supprimer le groupe « ${g.name} » ? Ses membres gardent leurs propres accès.`, { confirmer: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.groupesApi.supprimer(g.id));
      this.toasts.info(`Groupe « ${g.name} » supprimé`, 'Ses membres gardent leurs propres accès.');
    } catch (e) {
      this.toasts.error('Suppression impossible', messageErreur(e));
    }
    await this.charger();
  }
}
