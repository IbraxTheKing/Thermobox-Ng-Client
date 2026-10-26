import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, forkJoin, of, catchError } from 'rxjs';

import { Access, Group, User } from '../models/models';
import { byName } from '../core/text';
import { GroupService } from './group.service';
import { UserService } from './user.service';
import { onAccountChange } from '../core/auth';

/** A user with what decides what they see (UserRow of the JSF interface). */
export interface UserRow {
  user: User;
  /** Sees everything: an ADMIN, or an account that isn't limited. */
  unlimited: boolean;
  /** Elements granted to the user directly. */
  access: Access | null;
  /** Names of the groups they are in. */
  groups: string[];
}

/**
 * Users, their accesses and the groups (ADMIN): the Utilisateurs page and the « Utilisateurs et
 * groupes » tab of the Gestion page. Reading the accesses takes one request per user.
 */
@Injectable({ providedIn: 'root' })
export class AccessStore {
  private readonly usersApi = inject(UserService);
  private readonly groupsApi = inject(GroupService);

  readonly users = signal<UserRow[]>([]);
  readonly groups = signal<Group[]>([]);
  readonly loaded = signal(false);

  readonly byId = computed(() => new Map(this.users().map((l) => [l.user.id!, l])));

  constructor() {
    onAccountChange(() => {
      this.users.set([]);
      this.groups.set([]);
      this.loaded.set(false);
    });
  }

  async load(): Promise<void> {
    const [users, groups] = await firstValueFrom(forkJoin([this.usersApi.getAll(), this.groupsApi.list()]));
    const access = await firstValueFrom(
      users.length
        ? forkJoin(
            users.map((u) => (u.type === 'ADMIN' || u.id == null ? of(null) : this.usersApi.getAccess(u.id).pipe(catchError(() => of(null))))),
          )
        : of([] as (Access | null)[]),
    );
    this.groups.set([...groups].sort(byName((g) => g.name)));
    this.users.set(
      users
        .map((user, i) => ({
          user,
          access: access[i],
          unlimited: user.type === 'ADMIN' || access[i]?.restricted === false,
          groups: groups.filter((g) => g.members.some((m) => m.id === user.id)).map((g) => g.name),
        }))
        .sort(byName((l) => l.user.username)),
    );
    this.loaded.set(true);
  }

  /** « Tout (administrateur) », « Tout ThermoBox », « 2 élément(s) + 1 groupe(s) », « Aucun accès » */
  static shortSummary(l: UserRow): string {
    if (l.user.type === 'ADMIN') return 'Tout (administrateur)';
    if (l.unlimited) return 'Tout ThermoBox';
    const n = l.access?.elements.length ?? 0;
    if (!n && !l.groups.length) return 'Aucun accès';
    return [n ? `${n} élément(s)` : null, l.groups.length ? `${l.groups.length} groupe(s)` : null].filter(Boolean).join(' + ');
  }

  static noAccess(l: UserRow): boolean {
    return l.user.type !== 'ADMIN' && !l.unlimited && !(l.access?.elements.length ?? 0) && !l.groups.length;
  }

  /** « Accès à tout », « Accès : Bâtiment A, Salle 12 », « Aucun accès »… shown under each user. */
  static longSummary(l: UserRow): string {
    if (l.user.type === 'ADMIN') return 'Accès à tout (administrateur)';
    if (l.unlimited) return 'Accès à tout';
    const names = (l.access?.elements ?? []).map((e) => e.name ?? '').sort((a, b) => a.localeCompare(b, 'fr'));
    if (!names.length) return 'Aucun accès';
    if (names.length <= 3) return 'Accès : ' + names.join(', ');
    return `Accès : ${names.slice(0, 3).join(', ')} et ${names.length - 3} autre(s)`;
  }
}
