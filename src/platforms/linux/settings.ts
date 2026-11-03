import { Injectable, effect, signal } from '@angular/core';

const KEY = 'tb-linux';

interface Stored {
  /** Two fingers to the right on the touchpad go back (Préférences › Balayer pour revenir). */
  swipeBack?: boolean;
}

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

/**
 * The settings of the Linux app only, kept apart from the shared preferences. (The window and the
 * rendering are read by Rust before the page: linux.json, LinuxDesktopService.)
 */
@Injectable({ providedIn: 'root' })
export class LinuxSettings {
  /** Two fingers on the touchpad go back, the page following them (on by default). */
  readonly swipeBack = signal(read().swipeBack ?? true);

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ swipeBack: this.swipeBack() } satisfies Stored));
      } catch {
        // Not kept (storage refused): the next start takes the default
      }
    });
  }
}
