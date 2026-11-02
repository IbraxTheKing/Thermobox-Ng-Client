import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';

import { ServerService } from '../core/api.config';
import { ImportCheck, ImportOptions, ImportResult, ImportSession, ProvisionalPassword } from '../models/models';

/**
 * Import of accounts from a list of people (ADMIN, servers 26.12 and later: feature
 * "user-import") — /api/v2/users/import — and the provisional passwords.
 */
@Injectable({ providedIn: 'root' })
export class UserImportService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private url(path: string): string {
    return this.server.url(`/users/import${path}`);
  }

  /** Databases the server can import from (set on the server). */
  sources(): Observable<{ name: string }[]> {
    return this.http.get<{ name: string }[]>(this.url('/sources'));
  }

  /** A .xlsx or .csv file, as its bytes. */
  readFile(file: File): Observable<ImportSession> {
    return from(file.arrayBuffer()).pipe(
      switchMap((body) =>
        this.http.post<ImportSession>(this.url('/file'), body, { params: { name: file.name }, headers: { 'Content-Type': 'application/octet-stream' } }),
      ),
    );
  }

  readSource(name: string): Observable<ImportSession> {
    return this.http.post<ImportSession>(this.url('/source'), { name });
  }

  check(id: string, options: ImportOptions): Observable<ImportCheck> {
    return this.http.post<ImportCheck>(this.url(`/${encodeURIComponent(id)}/check`), options);
  }

  /** Creates the accounts: their provisional passwords are in the answer, and nowhere else. */
  confirm(id: string, options: ImportOptions): Observable<ImportResult> {
    return this.http.post<ImportResult>(this.url(`/${encodeURIComponent(id)}/confirm`), options);
  }

  cancel(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/${encodeURIComponent(id)}`));
  }

  /** A new provisional password for an account (forgotten, expired): given once. */
  provisionalPassword(userId: number, days?: number): Observable<ProvisionalPassword> {
    return this.http.post<ProvisionalPassword>(this.server.url(`/users/${userId}/provisional-password`), null, days ? { params: { days } } : {});
  }
}
