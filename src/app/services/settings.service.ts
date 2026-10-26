import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { ServerService } from '../core/api.config';
import { PreferencesService } from '../core/preferences';
import { Settings, StyleSite } from '../models/models';

/** Angular client of the settings resource — /api/v2/settings: the look chosen by an ADMIN for everyone. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private readonly prefs = inject(PreferencesService);

  /** Reads the style and applies it to this page. */
  load(): Observable<Settings> {
    return this.http.get<Settings>(this.server.url('/reglages')).pipe(tap((r) => this.prefs.style.set(r.style)));
  }

  /** ADMIN — for every user, on every device. */
  changeStyle(style: StyleSite): Observable<Settings> {
    return this.http.put<Settings>(this.server.url('/reglages'), { style }).pipe(tap((r) => this.prefs.style.set(r.style)));
  }
}
