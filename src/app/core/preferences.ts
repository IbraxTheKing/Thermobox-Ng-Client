import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { StyleSite } from '../models/models';
import { CouleursMaison } from './couleurs';

export type Theme = 'light' | 'dark';
/** What the user picked on the Préférences page: a theme, or the one of the system. */
export type ChoixTheme = Theme | 'auto';
export type Unite = 'C' | 'F';

interface Stockees {
  theme?: ChoixTheme;
  teinte?: boolean;
  unite?: Unite;
  clavier?: boolean;
  /** Computers: the side bar folded into a rail of icons. */
  barreReduite?: boolean;
  couleursMaison?: CouleursMaison;
  tolerance?: number;
  tailleCartes?: number;
}

const CLE = 'tb-preferences';

/**
 * Display preferences of this device (Préférences page, the only place they change): theme,
 * colours following the state, unit of the temperatures, keyboard shortcuts. Applied to <html> as
 * data-* attributes read by the stylesheets. The look chosen by an ADMIN for everyone ("panneau")
 * comes from the server (ReglagesService) and lands here too.
 *
 * Animations are not a setting: they follow the system (iOS « Réduire les animations », Android
 * « Supprimer les animations », the same setting on a computer), live.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockees: Stockees = lire();

  private readonly requeteSombre = matchMedia('(prefers-color-scheme: dark)');
  private readonly requeteMouvement = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly systemeSombre = signal(this.requeteSombre.matches);

  /** Theme picked; « auto » (the default) follows the system, also when it changes at night. */
  readonly choixTheme = signal<ChoixTheme>(this.stockees.theme ?? 'auto');
  /** Theme shown. */
  readonly theme = computed<Theme>(() => {
    const c = this.choixTheme();
    return c === 'auto' ? (this.systemeSombre() ? 'dark' : 'light') : c;
  });
  readonly teinte = signal(this.stockees.teinte ?? true);
  readonly unite = signal<Unite>(this.stockees.unite ?? 'C');
  readonly clavier = signal(this.stockees.clavier ?? true);
  /** Computers: the side bar shows the names of the pages, or only their icons. */
  readonly barreReduite = signal(this.stockees.barreReduite ?? false);
  /** « Maison »: rooms coloured by their gap to the consigne (default) or by their temperature. */
  readonly couleursMaison = signal<CouleursMaison>(this.stockees.couleursMaison ?? 'ecart');
  /** Degrees of gap that colour a room halfway (1 °C by default): the gap scales stretch with it. */
  readonly tolerance = signal(this.stockees.tolerance ?? 1);
  /** Computers: size of the cards of the dashboard, 1 = as designed. */
  readonly tailleCartes = signal(this.stockees.tailleCartes ?? 1);
  readonly style = signal<StyleSite>('verre');

  /** The system asks for less motion: no transitions between pages, nothing slides or pops. */
  readonly mouvementReduit = signal(this.requeteMouvement.matches);
  readonly animer = computed(() => !this.mouvementReduit());

  readonly fahrenheit = computed(() => this.unite() === 'F');

  constructor() {
    this.requeteSombre.addEventListener('change', (e) => this.systemeSombre.set(e.matches));
    this.requeteMouvement.addEventListener('change', (e) => this.mouvementReduit.set(e.matches));
    effect(() => {
      const root = this.doc.documentElement;
      root.dataset['theme'] = this.theme();
      root.dataset['motion'] = this.mouvementReduit() ? 'off' : 'on';
      root.dataset['teinte'] = this.teinte() ? 'on' : 'off';
      root.dataset['style'] = this.style();
      root.dataset['unite'] = this.unite() === 'F' ? '°F' : '°C';
      root.dataset['barre'] = this.barreReduite() ? 'reduite' : 'complete';
      // Colour of the browser / status bar, as the canvas
      const meta = this.doc.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', this.couleurFond());
    });
    effect(() => {
      ecrire({
        theme: this.choixTheme(),
        teinte: this.teinte(),
        unite: this.unite(),
        clavier: this.clavier(),
        barreReduite: this.barreReduite(),
        couleursMaison: this.couleursMaison(),
        tolerance: this.tolerance(),
        tailleCartes: this.tailleCartes(),
      });
    });
  }

  /** Colour of the page behind everything, for the status bar. */
  couleurFond(): string {
    const panneau = this.style() === 'panneau';
    // --tb-fond of tokens.css
    if (this.theme() === 'dark') return panneau ? '#181c1a' : '#151b19';
    return panneau ? '#e3e6e0' : '#e9efec';
  }

  /**
   * Picks a theme. When the shown theme changes, the new one spreads in a circle from [depuis]
   * (the button pressed), as in the JSF interface, where the browser supports view transitions.
   */
  changerTheme(choix: ChoixTheme, depuis?: HTMLElement): void {
    const avant = this.theme();
    const apres: Theme = choix === 'auto' ? (this.systemeSombre() ? 'dark' : 'light') : choix;
    const doc = this.doc as Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
    if (avant === apres || !depuis || !doc.startViewTransition || this.mouvementReduit()) {
      this.choixTheme.set(choix);
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
        this.choixTheme.set(choix);
        // The attribute must change inside the callback for the snapshot to see the new theme
        root.dataset['theme'] = apres;
      })
      .finished.finally(() => root.classList.remove('tb-theme-switch'));
  }
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
