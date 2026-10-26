import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService } from '../core/api.config';
import { Group, GroupRequest } from '../models/models';

/** Angular client of the groups resource — /api/v2/groups (ADMIN). */
@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path = ''): string {
    return this.server.url(`/groups${path}`);
  }

  list(): Observable<Group[]> {
    return this.http.get<Group[]>(this.url());
  }

  read(id: number): Observable<Group> {
    return this.http.get<Group>(this.url(`/${id}`));
  }

  create(g: GroupRequest): Observable<Group> {
    return this.http.post<Group>(this.url(), g);
  }

  /** Replaces the group: exactly these members and these elements. */
  edit(id: number, g: GroupRequest): Observable<Group> {
    return this.http.put<Group>(this.url(`/${id}`), g);
  }

  /** Its members keep their own accesses. */
  remove(id: number): Observable<void> {
    return this.http.delete<void>(this.url(`/${id}`));
  }

  /** Body to save an existing group, to edit. */
  static query(g: Group): GroupRequest {
    return { name: g.name, description: g.description, members: g.members.map((m) => m.id), elements: g.elements.map((e) => e.id) };
  }
}
