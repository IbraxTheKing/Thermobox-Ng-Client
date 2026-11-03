import { Injectable, effect, signal } from '@angular/core';

const KEY = 'tb-windows';

interface Stored {
  /** The Acrylic of the window and the blur of the bars (Préférences › Effets de transparence). */
  blur?: boolean;
}

/**
 * The settings of the Windows app only, kept apart from the shared preferences. The blur was kept
 * with them before (windowBlur of tb-preferences): read from there the first time.
 */
export function readWindowsSettings(): Stored {
  try {
    const own = localStorage.getItem(KEY);
    if (own) return JSON.parse(own) as Stored;
    const shared = JSON.parse(localStorage.getItem('tb-preferences') ?? '{}') as { windowBlur?: boolean };
    return { blur: shared.windowBlur };
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class WindowsSettings {
  /** Acrylic behind the side bar, blurred bars (on by default). */
  readonly blur = signal(readWindowsSettings().blur ?? true);

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ blur: this.blur() } satisfies Stored));
      } catch {
        // Not kept (storage refused): the next start takes the default
      }
    });
  }
}
