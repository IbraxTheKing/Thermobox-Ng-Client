import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/** An entry of the history of the window: the navigation that made it, and its address. */
interface Entry {
  id: number;
  url: string;
}

/**
 * The history of the main window of the macOS app, as the router numbers its navigations: the
 * entries before and after the current one, for back and forward (the toolbar, ⌘[ ⌘], the swipe
 * of the trackpad). Popstate moves in it, a new navigation drops what was after; it starts at the
 * first page of the app (not at the login page before it).
 */
@Injectable({ providedIn: 'root' })
export class MacHistory {
  private readonly router = inject(Router);
  private entries: Entry[] = [];
  private at = -1;
  private wasApp = false;
  readonly canGoBack = signal(false);
  readonly canGoForward = signal(false);

  constructor() {
    let pending: { restored: number | null; replace: boolean } | null = null;
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        pending = {
          restored: e.navigationTrigger === 'popstate' ? (e.restoredState?.navigationId ?? null) : null,
          replace: !!this.router.getCurrentNavigation()?.extras.replaceUrl,
        };
      } else if (e instanceof NavigationEnd) {
        if (!this.wasApp) this.at = -1;
        this.wasApp = e.urlAfterRedirects.startsWith('/app');
        this.follow(pending, { id: e.id, url: e.urlAfterRedirects });
        pending = null;
      }
    });
  }

  /** The address of the entry before the current one (null at the start). */
  previous(): string | null {
    return this.at > 0 ? this.entries[this.at - 1].url : null;
  }

  private follow(n: { restored: number | null; replace: boolean } | null, entry: Entry): void {
    const known = n?.restored != null ? this.entries.findIndex((e) => e.id === n.restored) : -1;
    if (known >= 0) {
      // Back or forward: the entry it went to
      this.at = known;
    } else if (n?.restored != null || this.at < 0) {
      // An entry from before this launch, or the first page: the history starts there
      this.entries = [{ id: n?.restored ?? entry.id, url: entry.url }];
      this.at = 0;
    } else if (n?.replace) {
      this.entries[this.at] = entry;
    } else {
      this.entries = [...this.entries.slice(0, this.at + 1), entry];
      this.at++;
    }
    this.canGoBack.set(this.at > 0);
    this.canGoForward.set(this.at < this.entries.length - 1);
  }
}
