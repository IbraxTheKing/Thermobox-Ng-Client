import { InjectionToken } from '@angular/core';

/**
 * How the pages of a platform move, where it differs from the web (TransitionsService: view
 * transitions, the card of a room morphing into its page, the entrance of the page part by part).
 * Given by the platform (TARGET.providers): the Windows app (a Frame of WinUI 3), the Linux app
 * (AdwNavigationView).
 */
export interface PageMotion {
  /**
   * A page change of the platform's own, without view transitions: the new page is known, the old
   * one still shown ([from], [to]: their routes; [popstate]: back or forward in the history;
   * [still]: no motion, as the system asks for less of it or the browser has shown it already).
   */
  leave?(from: string, to: string, popstate: boolean, still: boolean): MotionStep;
  /** The entrance of a new page, in the place of the web's: true when done. */
  entrance?(): boolean;
}

/** A page change under way (PageMotion.leave). */
export interface MotionStep {
  /** Back on the overview from a room: its card is put back where it was on the screen. */
  readonly returnToCard: boolean;
  /** The new page is drawn ([page]: the place of the pages; null: none). */
  arrive(page: HTMLElement | null): void;
  /** No new page: [cancelled] by the router, or another page change came first. */
  abort(cancelled: boolean): void;
}

export const PAGE_MOTION = new InjectionToken<PageMotion | null>('page motion', {
  providedIn: 'root',
  factory: () => null,
});
