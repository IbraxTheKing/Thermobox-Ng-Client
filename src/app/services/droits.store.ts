import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin, of, catchError } from 'rxjs';

import { Acces, Groupe, User } from '../models/models';
import { parNom } from '../core/texte';
import { GroupeService } from './groupe.service';
import { UserService } from './user.service';

/** A user with what decides what they see (LigneUser of the JSF interface). */
export interface LigneUser {
  user: User;
  /** Sees everything: an ADMIN, or an account that isn't limited. */
  illimite: boolean;
  /** Elements granted to the user directly. */
  acces: Acces | null;
  /** Names of the groups they are in. */
  groupes: string[];
}

/**
 * Users, their accesses and the groups (ADMIN): the Utilisateurs page and the « Utilisateurs et
 * groupes » tab of the Gestion page. Reading the accesses takes one request per user.
 */
@Injectable({ providedIn: 'root' })
export class DroitsStore {
  private readonly usersApi = inject(UserService);
  private readonly groupesApi = inject(GroupeService);

  readonly users = signal<LigneUser[]>([]);
  readonly groupes = signal<Groupe[]>([]);
  readonly charge = signal(false);

  readonly parId = computed(() => new Map(this.users().map((l) => [l.user.id!, l])));

  async charger(): Promise<void> {
    const [users, groupes] = await firstValueFrom(forkJoin([this.usersApi.getAll(), this.groupesApi.lister()]));
    const acces = await firstValueFrom(
      users.length
        ? forkJoin(
            users.map((u) => (u.type === 'ADMIN' || u.id == null ? of(null) : this.usersApi.getAcces(u.id).pipe(catchError(() => of(null))))),
          )
        : of([] as (Acces | null)[]),
    );
    this.groupes.set([...groupes].sort(parNom((g) => g.name)));
    this.users.set(
      users
        .map((user, i) => ({
          user,
          acces: acces[i],
          illimite: user.type === 'ADMIN' || acces[i]?.restricted === false,
          groupes: groupes.filter((g) => g.members.some((m) => m.id === user.id)).map((g) => g.name),
        }))
        .sort(parNom((l) => l.user.username)),
    );
    this.charge.set(true);
  }

  /** « Tout (administrateur) », « Tout ThermoBox », « 2 élément(s) + 1 groupe(s) », « Aucun accès » */
  static resumeCourt(l: LigneUser): string {
    if (l.user.type === 'ADMIN') return 'Tout (administrateur)';
    if (l.illimite) return 'Tout ThermoBox';
    const n = l.acces?.elements.length ?? 0;
    if (!n && !l.groupes.length) return 'Aucun accès';
    return [n ? `${n} élément(s)` : null, l.groupes.length ? `${l.groupes.length} groupe(s)` : null].filter(Boolean).join(' + ');
  }

  static sansAcces(l: LigneUser): boolean {
    return l.user.type !== 'ADMIN' && !l.illimite && !(l.acces?.elements.length ?? 0) && !l.groupes.length;
  }

  /** « Accès à tout », « Accès : Bâtiment A, Salle 12 », « Aucun accès »… shown under each user. */
  static resumeLong(l: LigneUser): string {
    if (l.user.type === 'ADMIN') return 'Accès à tout (administrateur)';
    if (l.illimite) return 'Accès à tout';
    const noms = (l.acces?.elements ?? []).map((e) => e.name ?? '').sort((a, b) => a.localeCompare(b, 'fr'));
    if (!noms.length) return 'Aucun accès';
    if (noms.length <= 3) return 'Accès : ' + noms.join(', ');
    return `Accès : ${noms.slice(0, 3).join(', ')} et ${noms.length - 3} autre(s)`;
  }
}
