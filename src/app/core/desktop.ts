import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { TARGET } from '../../platforms/current';
import { AuthService } from './auth';

/** A notification of the system: its title, its text. */
export interface SystemNotification {
  title: string;
  body: string;
}

/**
 * The desktop app (Tauri), as the shared client sees it: what it asks of the window it runs in.
 *
 * This class is the web's (and the mobile apps'): no desktop app, nothing to do. The desktop
 * builds put theirs in its place (TARGET.providers): platforms/desktop/desktop.service.ts, what
 * the three systems share, completed by platforms/windows, platforms/macos, platforms/linux.
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  protected readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** A desktop app. */
  readonly active: boolean = false;
  /** The settings in the menu bar of the system, in a window of their own (macOS). */
  readonly settingsInMenu = TARGET.traits.settingsInMenu;
  /** This window is the settings window (macOS). */
  readonly settingsWindow: boolean = false;
  /** The side bar moves the window (macOS: the traffic lights are over it). */
  readonly dragRail: boolean = false;

  /** The button of the title bar that opens or folds the side bar (the shell listens). */
  readonly paneToggles = signal(0);

  togglePane(): void {
    this.paneToggles.update((n) => n + 1);
  }

  /** The window fills the screen (the maximize button becomes « restore »). */
  readonly maximized = signal(false);
  /** The name of the system in « Application … » (À propos, the login page). */
  readonly name = computed(() => '');

  /** Once, at the start of the app (app.ts). */
  start(): void {
    // Nothing on the web
  }

  /**
   * The theme for the window: [choice] picked by the user, or 'auto' (the window and the webview
   * follow the system, the page sees its changes); [shown] the theme the page shows.
   */
  async windowTheme(choice: 'light' | 'dark' | 'auto', shown: 'light' | 'dark'): Promise<void> {
    void choice;
    void shown;
  }

  /** The settings: the page (macOS: their window). */
  async openSettings(): Promise<void> {
    await this.router.navigateByUrl(this.auth.user() ? '/app/preferences' : '/settings');
  }

  /** Notifications of the system (the setpoint reached or left); the mobile apps have theirs. */
  async notify(texts: SystemNotification[]): Promise<void> {
    void texts;
  }

  /** Whether notifications may be shown ([ask]: asked to the user if needed). */
  async notificationPermission(ask: boolean): Promise<boolean> {
    void ask;
    return false;
  }

  /** An image of a ThermoBox server for an <img src>: the address itself. */
  imageSource(url: string): Promise<string> {
    return Promise.resolve(url);
  }
}
