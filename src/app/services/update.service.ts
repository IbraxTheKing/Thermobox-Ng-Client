import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ServerService } from '../core/api.config';
import { DISCRETE } from '../core/http';
import { UpdatesState, Installation, Preparation } from '../models/models';

/** Angular client of the updates resource — /api/v2/updates: versions of the REST server. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path = ''): string {
    return this.server.url(`/updates${path}`);
  }

  /** Any logged-in user: installed version, available versions. */
  state(quiet = false): Observable<UpdatesState> {
    return this.http.get<UpdatesState>(this.url(), { context: new HttpContext().set(DISCRETE, quiet) });
  }

  /** ADMIN — checks GitHub now. */
  check(): Observable<UpdatesState> {
    return this.http.post<UpdatesState>(this.url('/check'), null);
  }

  /** ADMIN — progress of the last installation (null: none). */
  installation(): Observable<Installation | null> {
    return this.http.get<Installation | null>(this.url('/installation'), { context: new HttpContext().set(DISCRETE, true) });
  }

  /** ADMIN — checks, risks and backup before installing [version]. */
  prepare(version: string): Observable<Preparation> {
    return this.http.get<Preparation>(this.url(`/${encodeURIComponent(version)}`));
  }

  /** ADMIN — starts the installation; the server then restarts on the new version. */
  install(version: string, backupDatabase: boolean, acceptRisks: boolean): Observable<Installation> {
    return this.http.post<Installation>(this.url(`/${encodeURIComponent(version)}/install`), { backupDatabase, acceptRisks });
  }
}
