import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';

import { ServerService } from './api.config';
import { AuthService } from './auth';
import { PreferencesService } from './preferences';
import { TAURI } from './tauri';
import { UnitService } from './unit';
import { ToastService } from './messages';

/** A room that started or stopped respecting its setpoint (GET /api/v2/notifications/setpoints). */
export interface SetpointEvent {
  roomId: number;
  name: string;
  place: string;
  state: 'STABLE' | 'HEATING' | 'TOO_HOT';
  previous: 'STABLE' | 'HEATING' | 'TOO_HOT';
  temperature: number;
  setpoint: number;
  at: string;
}

interface SetpointEvents {
  since: string;
  now: string;
  events: SetpointEvent[];
}

/** What one notification says. */
export interface NotificationText {
  title: string;
  body: string;
  roomId: number | null;
}

/** How often the server is asked while the app is open. */
const EVERY = 2 * 60_000;
/** More changes at once than this: one notification that sums them up. */
const AT_ONCE = 4;
const SINCE_KEY = 'tb-notify-since:';

/**
 * Notifications of the setpoint, in the apps (iOS, Android: local notifications; Windows, macOS,
 * Linux: the notifications of the system): « Salle A001 a atteint sa consigne », « Salle B204 est
 * trop chaude ». Préférences turns them on (off by default) and picks the rooms: the favorites or
 * every room the user sees.
 *
 * While the app is open (in front or behind other windows), the server is asked every
 * [EVERY] ms what changed since the last answer (ThermoBox 26.12: the server reads it from the
 * measures, nothing is lost between two visits, at most 6 hours back). A phone puts an app in the
 * background to sleep: nothing is notified while it sleeps; what changed shows when it wakes, if
 * it was less than 6 hours ago.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly server = inject(ServerService);
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(PreferencesService);
  private readonly unit = inject(UnitService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly doc = inject(DOCUMENT);

  /** The apps only: a browser tab is not kept open to notify. */
  readonly available = Capacitor.isNativePlatform() || TAURI;
  /** The server answers (ThermoBox 26.12 and later); null: not asked yet. */
  readonly supported = signal<boolean | null>(null);
  /** The system refused (Préférences says how to allow them). */
  readonly denied = signal(false);
  readonly active = computed(() => this.available && this.prefs.notifications() && this.auth.loggedIn() && !this.denied());

  /** The last question to the server: when, how many changes, or why it failed (Préférences). */
  readonly last = signal<{ at: Date; events: number; error: string | null } | null>(null);

  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private listening = false;

  start(): void {
    if (!this.available) return;
    effect(() => {
      const on = this.active();
      // A change of account or of rooms: asked again now
      this.auth.key();
      this.prefs.notifyRooms();
      untracked(() => (on ? this.run() : this.stop()));
    });
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'visible' && this.active()) void this.check();
    });
  }

  /** Préférences: turns them on, after the system allowed them. */
  async enable(): Promise<boolean> {
    const allowed = await this.permission(true);
    this.denied.set(!allowed);
    if (!allowed) {
      this.toasts.error('Les notifications sont bloquées pour Thermobox dans les réglages du système.');
      return false;
    }
    this.prefs.notifications.set(true);
    return true;
  }

  private run(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.check(), EVERY);
    void this.listen();
    void this.check();
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Asks the server what changed since the last answer, and notifies it. */
  async check(): Promise<void> {
    const key = this.auth.key();
    if (this.busy || !key || !this.active()) return;
    this.busy = true;
    try {
      const sinceKey = SINCE_KEY + key;
      const since = read(sinceKey);
      const params: Record<string, string> = {};
      if (since) params['since'] = since;
      if (this.prefs.notifyRooms() === 'favorites') {
        const favorites = await firstValueFrom(this.http.get<number[]>(this.server.url('/favorites')));
        // No favorite: nothing to watch
        if (!favorites.length) {
          this.supported.set(true);
          return;
        }
        params['ids'] = favorites.join(',');
      }
      const r = await firstValueFrom(this.http.get<SetpointEvents>(this.server.url('/notifications/setpoints'), { params }));
      this.supported.set(true);
      write(sinceKey, r.now);
      this.last.set({ at: new Date(), events: r.events.length, error: null });
      // The first time: from now on, not what happened before the notifications were on
      if (since) await this.notify(r.events);
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 404 || e.status === 405)) {
        this.supported.set(false);
        this.stop();
      }
      this.last.set({ at: new Date(), events: 0, error: e instanceof HttpErrorResponse ? `HTTP ${e.status}` : String((e as Error)?.message ?? e) });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Préférences › « Tester »: a notification now, to see that the system shows them (allowed,
   * not silenced); then the server is asked at once. False when the system refused.
   */
  async test(): Promise<boolean> {
    const allowed = await this.permission(true);
    this.denied.set(!allowed);
    if (!allowed) return false;
    await this.send([{ title: $localize`Notification de test`, body: $localize`Les changements de consigne de tes salles s'afficheront ainsi.`, roomId: null }]);
    void this.check();
    return true;
  }

  /** The texts for [events] (one each, or one for all when they are many). */
  texts(events: SetpointEvent[]): NotificationText[] {
    if (events.length > AT_ONCE) {
      const reached = events.filter((e) => e.state === 'STABLE').length;
      const off = events.length - reached;
      const parts = [];
      if (reached) parts.push(`${reached} ${reached > 1 ? $localize`ont atteint leur consigne` : $localize`a atteint sa consigne`}`);
      if (off) parts.push(`${off} ${off > 1 ? $localize`s'en sont éloignées` : $localize`s'en est éloignée`}`);
      return [{ title: $localize`${events.length} salles ont changé`, body: parts.join(', ') + '.', roomId: null }];
    }
    return events.map((e) => {
      const t = `${this.unit.t(e.temperature)} ${this.unit.symbol()}`;
      const sp = `${this.unit.t(e.setpoint)} ${this.unit.symbol()}`;
      const where = e.place ? ` · ${e.place}` : '';
      switch (e.state) {
        case 'STABLE':
          return { title: $localize`${e.name} a atteint sa consigne`, body: $localize`${t} pour ${sp}${where}`, roomId: e.roomId };
        case 'HEATING':
          return { title: $localize`${e.name} est sous sa consigne`, body: $localize`${t} pour ${sp} (${this.unit.delta(e.temperature - e.setpoint)})${where}`, roomId: e.roomId };
        default:
          return { title: $localize`${e.name} est trop chaude`, body: $localize`${t} pour ${sp} (${this.unit.delta(e.temperature - e.setpoint)})${where}`, roomId: e.roomId };
      }
    });
  }

  private async notify(events: SetpointEvent[]): Promise<void> {
    if (!events.length) return;
    await this.send(this.texts(events));
  }

  private async send(texts: NotificationText[]): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: texts.map((n, i) => ({
          id: (Date.now() % 1_000_000_000) + i,
          title: n.title,
          body: n.body,
          extra: { roomId: n.roomId },
          group: 'thermobox-setpoints',
        })),
      });
      return;
    }
    if (TAURI) {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      for (const n of texts) sendNotification({ title: n.title, body: n.body });
    }
  }

  /** iOS / Android: a notification touched opens its room. */
  private async listen(): Promise<void> {
    if (this.listening || !Capacitor.isNativePlatform()) return;
    this.listening = true;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const id = Number((a.notification.extra as { roomId?: number } | undefined)?.roomId);
      void this.router.navigateByUrl(Number.isFinite(id) && id > 0 ? `/app/room/${id}` : '/app/overview');
    });
  }

  private async permission(ask: boolean): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        let p = await LocalNotifications.checkPermissions();
        if (p.display !== 'granted' && ask) p = await LocalNotifications.requestPermissions();
        return p.display === 'granted';
      }
      if (TAURI) {
        const n = await import('@tauri-apps/plugin-notification');
        if (await n.isPermissionGranted()) return true;
        return ask && (await n.requestPermission()) === 'granted';
      }
    } catch {
      return false;
    }
    return false;
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing */
  }
}
