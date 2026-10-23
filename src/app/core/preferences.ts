import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { StyleSite } from '../models/models';

export type Theme = 'light' | 'dark';
export type Unite = 'C' | 'F';

interface Stockees {
  theme?: Theme;
  animations?: boolean;
  teinte?: boolean;
  unite?: Unite;
  clavier?: boolean;
}

const CLE = 'tb-preferences';

/**
 * Display preferences of this device (Préférences page), as the cookies of the JSF interface:
 * theme, animations, colours following the state, unit of the temperatures, keyboard shortcuts.
 * Applied to <html> as data-* attributes read by the stylesheets. The look chosen by an ADMIN
 * for everyone ("panneau") comes from the server (ReglagesService) and lands here too.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockees: Stockees = lire();

  /** No theme chosen yet: the system's (a phone in dark mode gets the dark theme). */
  readonly theme = signal<Theme>(this.stockees.theme ?? (systemeSombre() ? 'dark' : 'light'));
  readonly animations = signal(this.stockees.animations ?? true);
  readonly teinte = signal(this.stockees.teinte ?? true);
  readonly unite = signal<Unite>(this.stockees.unite ?? 'C');
  readonly clavier = signal(this.stockees.clavier ?? true);
  readonly style = signal<StyleSite>('verre');

  /** The system asks for less motion: animations stay reduced whatever the switch says. */
  readonly mouvementReduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  readonly fahrenheit = computed(() => this.unite() === 'F');

  constructor() {
    effect(() => {
      const root = this.doc.documentElement;
      root.dataset['theme'] = this.theme();
      root.dataset['motion'] = this.animations() ? 'on' : 'off';
      root.dataset['teinte'] = this.teinte() ? 'on' : 'off';
      root.dataset['style'] = this.style();
      root.dataset['unite'] = this.unite() === 'F' ? '°F' : '°C';
      // Colour of the browser / status bar, as the canvas
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', this.couleurFond());
    });
    effect(() => {
      ecrire({
        theme: this.theme(),
        animations: this.animations(),
        teinte: this.teinte(),
        unite: this.unite(),
        clavier: this.clavier(),
      });
    });
  }

  /** Colour of the page behind everything, for the status bar. */
  couleurFond(): string {
    const panneau = this.style() === 'panneau';
    if (this.theme() === 'dark') return panneau ? '#16191e' : '#0f141c';
    return panneau ? '#eef1f5' : '#bccde2';
  }

  /**
   * Switches light / dark. The new theme spreads in a circle from [depuis] (the button), as in
   * the JSF interface, where the browser supports view transitions.
   */
  basculerTheme(depuis?: HTMLElement): void {
    const suivant: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    const doc = this.doc as Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
    if (!depuis || !doc.startViewTransition || !this.animations() || this.mouvementReduit) {
      this.theme.set(suivant);
      return;
    }
    const r = depuis.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const rayon = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const root = this.doc.documentElement;
    root.style.setProperty('--tb-reveal-from', `circle(0px at ${x}px ${y}px)`);
    root.style.setProperty('--tb-reveal', `circle(${rayon}px at ${x}px ${y}px)`);
    root.classList.add('tb-theme-switch');
    doc
      .startViewTransition(() => {
        this.theme.set(suivant);
        // The attribute must change inside the callback for the snapshot to see the new theme
        root.dataset['theme'] = suivant;
      })
      .finished.finally(() => root.classList.remove('tb-theme-switch'));
  }
}

function systemeSombre(): boolean {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function lire(): Stockees {
  try {
    return JSON.parse(localStorage.getItem(CLE) ?? '{}') as Stockees;
  } catch {
    return {};
  }
}

function ecrire(p: Stockees): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(p));
  } catch {
    /* private browsing */
  }
}
