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
  /** Elements granted to the user directly (null: not read yet, or none to read for an ADMIN). */
  access: Access | null;
  /** Their access was read (see [AccessStore.ensure]). */
  read: boolean;
  /** Names of the groups they are in. */
  groups: string[];
}

/** Accesses read at the same time. */
const PARALLEL = 6;

/**
 * Users, their accesses and the groups (ADMIN): the Utilisateurs page and the « Utilisateurs et
 * groupes » tab of the Gestion page. Reading the accesses takes one request per user: they are
 * read for the users shown (and before changing them), a few at a time, not for hundreds at once.
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

  /** Users and groups; the accesses already read stay shown, and are read again when asked. */
  async load(): Promise<void> {
    const [users, groups] = await firstValueFrom(forkJoin([this.usersApi.getAll(), this.groupsApi.list()]));
    const before = this.byId();
    this.groups.set([...groups].sort(byName((g) => g.name)));
    this.users.set(
      users
        .map((user): UserRow => {
          const old = before.get(user.id!);
          const access = user.type === 'ADMIN' ? null : (old?.access ?? null);
          return {
            user,
            access,
            read: user.type === 'ADMIN',
            unlimited: user.type === 'ADMIN' || access?.restricted === false,
            groups: groups.filter((g) => g.members.some((m) => m.id === user.id)).map((g) => g.name),
          };
        })
        .sort(byName((l) => l.user.username)),
    );
    this.reading.clear();
    this.loaded.set(true);
  }

  /** Accesses being read, or waiting their turn: each read once. */
  private readonly reading = new Map<number, Promise<void>>();

  /** Reads the accesses of [ids] not read yet ([PARALLEL] at a time). */
  async ensure(ids: number[]): Promise<void> {
    const rows = this.byId();
    const todo = ids.filter((id) => rows.get(id) && !rows.get(id)!.read);
    const queue = todo.filter((id) => !this.reading.has(id));
    // Each one waits for its turn (a free slot among [PARALLEL]), and is known as being read at once
    for (const id of queue) {
      const turn = this.slots.then(async () => {
        await this.acquire();
        try {
          await this.readOne(id);
        } finally {
          this.release();
        }
      });
      this.reading.set(id, turn);
    }
    await Promise.all(todo.map((id) => this.reading.get(id)));
  }

  private readonly slots = Promise.resolve();
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  private acquire(): Promise<void> {
    if (this.running < PARALLEL) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.running++, resolve())));
  }

  private release(): void {
    this.running--;
    this.waiting.shift()?.();
  }

  private async readOne(id: number): Promise<void> {
    const access = await firstValueFrom(this.usersApi.getAccess(id).pipe(catchError(() => of(null))));
    this.users.update((l) => l.map((r) => (r.user.id === id ? { ...r, access, read: true, unlimited: r.user.type === 'ADMIN' || access?.restricted === false } : r)));
    this.reading.delete(id);
  }

  /** « Tout (administrateur) », « Tout ThermoBox », « 2 élément(s) + 1 groupe(s) », « Aucun accès » */
  static shortSummary(l: UserRow): string {
    if (l.user.type === 'ADMIN') return 'Tout (administrateur)';
    if (!l.read && !l.access) return '…';
    if (l.unlimited) return 'Tout ThermoBox';
    const n = l.access?.elements.length ?? 0;
    if (!n && !l.groups.length) return 'Aucun accès';
    return [n ? `${n} élément(s)` : null, l.groups.length ? `${l.groups.length} groupe(s)` : null].filter(Boolean).join(' + ');
  }

  static noAccess(l: UserRow): boolean {
    return l.read && l.user.type !== 'ADMIN' && !l.unlimited && !(l.access?.elements.length ?? 0) && !l.groups.length;
  }

  /** « Accès à tout », « Accès : Bâtiment A, Salle 12 », « Aucun accès »… shown under each user. */
  static longSummary(l: UserRow): string {
    if (l.user.type === 'ADMIN') return 'Accès à tout (administrateur)';
    if (!l.read && !l.access) return 'Accès…';
    if (l.unlimited) return 'Accès à tout';
    const names = (l.access?.elements ?? []).map((e) => e.name ?? '').sort((a, b) => a.localeCompare(b, 'fr'));
    if (!names.length) return 'Aucun accès';
    if (names.length <= 3) return 'Accès : ' + names.join(', ');
    return `Accès : ${names.slice(0, 3).join(', ')} et ${names.length - 3} autre(s)`;
  }
}
