import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { FlipService } from '../../core/flip';
import { AvisMajService } from '../../core/avis-maj';
import { ConfirmService, ToastService } from '../../core/messages';
import { initiale } from '../../core/texte';
import { ROLES, User, UserRole } from '../../models/models';
import { ArbreStore } from '../../services/arbre.store';
import { DroitsStore, LigneUser } from '../../services/droits.store';
import { UserService } from '../../services/user.service';
import { TbArbreAcces } from '../../ui/arbre-acces';
import { TbPassword } from '../../ui/controles';
import { TbSheet } from '../../ui/sheet';
import { octets } from '../auth/register';

/** Utilisateurs (users.xhtml), ADMIN: accounts, their role and what they may see. */
@Component({
  selector: 'tb-utilisateurs',
  imports: [RouterLink, TbSheet, TbPassword, TbArbreAcces],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './utilisateurs.html',
})
export class UtilisateursPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly avis = inject(AvisMajService);
  protected readonly droits = inject(DroitsStore);
  private readonly flip = inject(FlipService);

  protected chercher(v: string): void {
    this.flip.animer(() => this.recherche.set(v));
  }
  protected readonly arbre = inject(ArbreStore);
  private readonly users = inject(UserService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly arbreAcces = viewChild(TbArbreAcces);

  protected readonly roles = ROLES;
  protected readonly recherche = signal('');
  /** Role chip picked, null for all. */
  protected readonly roleFiltre = signal<UserRole | null>(null);

  protected readonly visibles = computed(() => {
    const mot = this.recherche().trim().toLowerCase();
    return this.droits.users().filter((l) => (!mot || l.user.username.toLowerCase().includes(mot)) && (this.roleFiltre() == null || l.user.type === this.roleFiltre()));
  });

  protected nombre(r: UserRole): number {
    return this.droits.users().filter((l) => l.user.type === r).length;
  }

  protected initiale = initiale;
  protected resume = DroitsStore.resumeLong;

  async ngOnInit(): Promise<void> {
    await this.charger();
  }

  private async charger(): Promise<void> {
    try {
      await this.droits.charger();
    } catch (e) {
      this.toasts.error('Impossible de charger les utilisateurs', messageErreur(e));
    }
  }

  protected basculerRole(r: UserRole): void {
    this.roleFiltre.update((x) => (x === r ? null : r));
  }

  // ---------------------------------------------------------------- create / edit

  protected readonly dlgUser = signal(false);
  protected readonly selectionne = signal<User | null>(null);
  protected readonly formNom = signal('');
  protected readonly formRole = signal<UserRole | ''>('');
  protected readonly formMdp = signal('');
  protected readonly formEnvoye = signal(false);
  protected readonly creation = computed(() => this.selectionne()?.id == null);

  protected readonly erreurNom = computed(() => {
    const n = this.formNom().trim();
    if (!n) return "Nom d'utilisateur obligatoire";
    if (n.length < 3 || n.length > 50) return 'Entre 3 et 50 caractères';
    return null;
  });
  protected readonly erreurMdp = computed(() => {
    const p = this.formMdp();
    if (!p) return this.creation() ? 'Mot de passe obligatoire' : null;
    if (p.length < 8) return 'Au moins 8 caractères';
    if (octets(p) > 72) return 'Trop long (72 octets au plus)';
    return null;
  });

  protected creer(): void {
    this.selectionne.set({ username: '' });
    this.formNom.set('');
    this.formRole.set('');
    this.formMdp.set('');
    this.formEnvoye.set(false);
    this.dlgUser.set(true);
  }

  protected modifier(u: User): void {
    this.selectionne.set(u);
    this.formNom.set(u.username);
    this.formRole.set(u.type ?? '');
    this.formMdp.set('');
    this.formEnvoye.set(false);
    this.dlgUser.set(true);
  }

  protected async enregistrer(e: Event): Promise<void> {
    e.preventDefault();
    this.formEnvoye.set(true);
    const role = this.formRole();
    if (this.erreurNom() || this.erreurMdp() || !role) return;
    const nom = this.formNom().trim();
    const u = this.selectionne();
    try {
      if (this.creation()) {
        // A new account is a VIEWER: its role is then set as chosen
        await firstValueFrom(this.users.add({ username: nom, password: this.formMdp() }));
        const cree = await firstValueFrom(this.users.getByUsername(nom));
        if (cree?.id != null && role !== 'VIEWER') await firstValueFrom(this.users.update(cree.id, { type: role }));
        this.toasts.info(`Utilisateur « ${nom} » créé`, role === 'ADMIN' ? null : "Il n'a encore accès à aucune salle : donnez-lui des accès avec le bouton Accès.");
      } else if (u?.id != null) {
        const maj = await firstValueFrom(this.users.update(u.id, { username: nom, type: role, ...(this.formMdp() ? { password: this.formMdp() } : {}) }));
        if (this.auth.estMoi(u)) this.auth.majUtilisateur(maj);
        this.toasts.info(`Utilisateur « ${nom} » modifié`);
      }
      this.dlgUser.set(false);
      await this.charger();
    } catch (err) {
      const m = messageErreur(err, 'Enregistrement impossible');
      this.toasts.error(m === 'Username already taken' ? "Ce nom d'utilisateur est déjà pris" : 'Enregistrement impossible', m === 'Username already taken' ? null : m);
    }
  }

  protected async supprimer(u: User): Promise<void> {
    if (this.auth.estMoi(u)) {
      this.toasts.error('Supprime ton propre compte depuis la page Profil');
      return;
    }
    if (!(await this.confirm.demander('Supprimer', `Supprimer l'utilisateur « ${u.username} » ?`, { confirmer: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.users.remove(u.id!));
      this.toasts.info(`Utilisateur « ${u.username} » supprimé`);
    } catch (e) {
      this.toasts.error('Suppression impossible', messageErreur(e));
    }
    await this.charger();
  }

  // ---------------------------------------------------------------- accesses

  protected readonly dlgAcces = signal(false);
  protected readonly accesUser = signal<LigneUser | null>(null);
  /** false: sees everything; true: only what is ticked. */
  protected readonly accesRestreint = signal(true);
  protected readonly accesCoches = signal<Set<number>>(new Set());

  protected async ouvrirAcces(l: LigneUser): Promise<void> {
    if (!this.arbre.arbre()) await this.arbre.charger().catch(() => undefined);
    try {
      const a = await firstValueFrom(this.users.getAcces(l.user.id!));
      this.accesUser.set(l);
      this.accesRestreint.set(a.restricted);
      this.accesCoches.set(TbArbreAcces.cocher(this.arbre.noeuds(), a.elements.map((e) => e.id)));
      this.dlgAcces.set(true);
    } catch (e) {
      this.toasts.error('Impossible de lire les accès', messageErreur(e));
    }
  }

  /**
   * An element counts with everything it contains (and what will be added to it later) only if it
   * is ticked with all its content; otherwise only its ticked content counts.
   */
  protected async enregistrerAcces(): Promise<void> {
    const l = this.accesUser();
    if (!l) return;
    const elements = this.accesRestreint() ? (this.arbreAcces()?.retenus() ?? []) : [];
    try {
      await firstValueFrom(this.users.setAcces(l.user.id!, this.accesRestreint(), elements));
      this.toasts.info(`Accès de « ${l.user.username} » enregistrés`, this.accesRestreint() ? `${elements.length} élément(s) et leur contenu` : 'Accès à tout');
      this.dlgAcces.set(false);
      await this.charger();
    } catch (e) {
      this.toasts.error('Enregistrement impossible', messageErreur(e));
    }
  }
}
