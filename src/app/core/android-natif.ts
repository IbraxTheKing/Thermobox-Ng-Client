import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { filter, take } from 'rxjs';

import { PreferencesService } from './preferences';
import { TransitionsService } from './transitions';

/** Onglet de la barre native : id = adresse de la page, icone = nom d'un dessin du plugin. */
export interface OngletNatif {
  id: string;
  label: string;
  icone: string;
  badge?: boolean;
}

/** #RRGGBB ou #AARRGGBB */
interface CouleursBarre {
  fond: string;
  normal: string;
  actif: string;
  indicateur: string;
  badge: string;
}

interface ThermoboxNatifPlugin {
  configurerBarre(o: { onglets: OngletNatif[]; actif: string | null; visible: boolean; sombre: boolean; couleurs: CouleursBarre }): Promise<{ hauteur: number }>;
  selectionnerOnglet(o: { id: string | null }): Promise<void>;
  afficherBarre(o: { visible: boolean }): Promise<{ hauteur: number }>;
  configurerFab(o: { visible: boolean; label?: string; icone?: string; etendu?: boolean; couleurs?: { fond: string; texte: string } }): Promise<void>;
  etendreFab(o: { etendu: boolean }): Promise<void>;
  snackbar(o: { texte: string; longue?: boolean }): Promise<void>;
  confirmer(o: { titre: string; message: string; confirmer?: string; annuler?: string; danger?: boolean }): Promise<{ valeur: boolean }>;
  menu(o: {
    titre: string;
    sousTitre: string;
    options: { id: string; label: string; icone: string; danger: boolean; coche?: boolean }[];
    couleurs: { fond: string; texte: string; texteSecondaire: string; danger: string; accent: string };
  }): Promise<{ id: string | null }>;
  addListener(e: 'onglet', f: (d: { id: string; retouche: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'fab', f: () => void): Promise<PluginListenerHandle>;
  addListener(e: 'hauteur', f: (d: { hauteur: number; visible: boolean }) => void): Promise<PluginListenerHandle>;
  activerRetour(o: { actif: boolean }): Promise<void>;
  addListener(e: 'retour', f: (d: EtapeRetour) => void): Promise<PluginListenerHandle>;
}

/** Retour d'Android, étape par étape (geste prédictif) ou d'un coup (bouton : « valide » seul). */
interface EtapeRetour {
  etape: 'debut' | 'progres' | 'annule' | 'valide';
  /** 0 → 1 pendant que le doigt glisse depuis le bord. */
  progres?: number;
  bord?: 'gauche' | 'droite';
  /** Hauteur du doigt, px CSS. */
  y?: number;
}

/** Composants natifs Material 3 (plugins/thermobox-natif), dans l'application Android seulement. */
export const ANDROID_NATIF =
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android' &&
  // Built into the app only when « npx cap sync » found it (npm install done): otherwise the page
  // keeps its own navigation bar, buttons and sheets rather than showing none.
  Capacitor.isPluginAvailable('ThermoboxNatif');

if (Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform() && !ANDROID_NATIF) {
  console.warn('Plugin ThermoboxNatif absent de l\'application : npm install, puis npx cap sync android.');
}

const plugin = ANDROID_NATIF ? registerPlugin<ThermoboxNatifPlugin>('ThermoboxNatif') : null;

/** Icônes PrimeIcons de la page → dessins du plugin. */
const ICONES: Record<string, string> = {
  'pi-th-large': 'apercu',
  'pi-building': 'salles',
  'pi-chart-line': 'mesures',
  'pi-sliders-h': 'gerer',
  'pi-users': 'utilisateurs',
  'pi-cloud-download': 'maj',
  'pi-ellipsis-h': 'plus',
  'pi-user': 'compte',
  'pi-home': 'maison',
  'pi-cog': 'reglages',
  'pi-plus': 'ajouter',
  'pi-user-plus': 'ajouter_personne',
  'pi-eye': 'voir',
  'pi-external-link': 'ouvrir',
  'pi-pencil': 'modifier',
  'pi-link': 'detacher',
  'pi-trash': 'supprimer',
  'pi-key': 'cle',
  'pi-arrow-right': 'deplacer',
  'pi-star': 'etoile',
  'pi-star-fill': 'etoile',
};

export function iconeNative(classes: string, defaut = 'ajouter'): string {
  const pi = classes.split(/\s+/).find((c) => c in ICONES);
  return pi ? ICONES[pi] : defaut;
}

/** A theme colour (custom property, may be a color-mix) as #AARRGGBB, read by the browser. */
let sonde: { el: HTMLElement; ctx: CanvasRenderingContext2D } | undefined;
function hex(...vars: string[]): string {
  sonde ??= (() => {
    const el = document.createElement('span');
    el.style.display = 'none';
    document.body.appendChild(el);
    const toile = document.createElement('canvas');
    toile.width = toile.height = 1;
    return { el, ctx: toile.getContext('2d', { willReadFrequently: true })! };
  })();
  sonde.el.style.color = vars.map((v) => `var(${v}`).join(', ') + ')'.repeat(vars.length);
  const calculee = getComputedStyle(sonde.el).color;
  sonde.ctx.clearRect(0, 0, 1, 1);
  sonde.ctx.fillStyle = '#000';
  sonde.ctx.fillStyle = calculee;
  sonde.ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = sonde.ctx.getImageData(0, 0, 1, 1).data;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(a)}${h(r)}${h(g)}${h(b)}`;
}

/**
 * Sheets that are menus (TbSheet menuNatif): a native Material bottom sheet, in the colours of
 * the page; the id of the row picked, null when it is dismissed.
 */
export const natifMenu = plugin
  ? async (titre: string, sousTitre: string, options: { id: string; label: string; icone: string; danger: boolean; coche?: boolean }[]) =>
      (
        await plugin.menu({
          titre,
          sousTitre,
          // No icon (a list of choices): none drawn
          options: options.map((o) => ({ ...o, icone: o.icone ? iconeNative(o.icone, 'ouvrir') : '' })),
          couleurs: {
            fond: hex('--tb-m3-container-high', '--md-surface-container-high'),
            texte: hex('--md-on-surface'),
            texteSecondaire: hex('--md-on-surface-variant'),
            danger: hex('--md-error'),
            accent: hex('--md-primary'),
          },
        })
      ).id
  : null;

/**
 * Notifications et confirmations natives (snackbar, dialogue Material) : utilisées par
 * ToastService et ConfirmService dans l'application Android, la page garde les siennes ailleurs.
 */
export const natifMessages = plugin
  ? {
      snackbar: (texte: string, longue: boolean) => void plugin.snackbar({ texte, longue }).catch(() => undefined),
      confirmer: async (titre: string, message: string, confirmer: string, danger: boolean) =>
        (await plugin.confirmer({ titre, message, confirmer, annuler: 'Annuler', danger })).valeur,
    }
  : null;

/**
 * Application Android : la barre de navigation du bas et le bouton d'action principal des pages
 * sont des composants Material 3 natifs, posés au-dessus de la page (plugin ThermoboxNatif) ; la
 * page cache les siens (html.tb-android-natif) et laisse en bas la place prise par la barre
 * (--tb-nav-bas). Le bouton retour d'Android ferme d'abord ce qui est ouvert, puis revient en
 * arrière, puis met l'application en arrière-plan.
 *
 * Ailleurs (web, iOS, PWA), rien ne change : la page dessine tout.
 */
@Injectable({ providedIn: 'root' })
export class AndroidNatifService {
  private readonly doc = inject(DOCUMENT);
  private readonly root = this.doc.documentElement;
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);
  private readonly transitions = inject(TransitionsService);
  readonly actif = ANDROID_NATIF;

  /** Hauteur de la barre native en px CSS (0 : cachée). */
  readonly hauteurBarre = signal(0);
  private clavier = false;
  /** A sheet of the page is open: the native bar would cover its bottom (its buttons). */
  private feuille = false;
  private barreVoulue = false;
  private fabCible: HTMLElement | null = null;
  private fabConfig = '';
  private fabEtendu = true;
  private dernierY = 0;
  private surOnglet: ((id: string, retouche: boolean) => void) | null = null;
  private dernier: Parameters<AndroidNatifService['configurerBarre']> | null = null;
  /** Ce qui a été envoyé à la barre : rien n'est renvoyé s'il n'a pas changé. */
  private barreEnvoyee = '';
  /** Geste de retour en cours : ce qu'il fera, et la page qui suit le doigt. */
  private geste: { mode: 'page' | 'autre'; main: HTMLElement | null; y0: number } | null = null;

  constructor() {
    if (!plugin) return;
    this.root.classList.add('tb-android-natif');
    void plugin.addListener('onglet', ({ id, retouche }) => this.surOnglet?.(id, retouche));
    void plugin.addListener('fab', () => this.fabCible?.click());
    void plugin.addListener('hauteur', ({ hauteur }) => this.poserHauteur(hauteur));
    // Back: the plugin's (predictive gesture, Android 14+); the App plugin's only with an older
    // build of the plugin
    void App.addListener('backButton', () => this.retour());
    void plugin.addListener('retour', (e) => this.surRetour(e));
    plugin.activerRetour({ actif: true }).catch(() => undefined);

    // Keyboard open (a field has the focus): the bar and the button make room
    this.doc.addEventListener('focusin', (e) => {
      if (this.estChamp(e.target)) this.clavierOuvert(true);
    });
    this.doc.addEventListener('focusout', () => setTimeout(() => this.clavierOuvert(this.estChamp(this.doc.activeElement)), 50));

    // The main action of each page: follows the page (and its tabs, its selection mode…)
    new MutationObserver(() => {
      this.suivreFeuilles();
      this.planifierFab();
    }).observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    this.installerSelects();
    addEventListener('scroll', () => this.surDefilement(), { passive: true });
    // Theme, colour of the state, look: the native parts take the new colours
    new MutationObserver(() => {
      if (this.dernier) this.configurerBarre(...this.dernier);
      this.fabConfig = '';
      this.planifierFab();
    }).observe(this.root, { attributes: true, attributeFilter: ['data-theme', 'data-ton', 'data-style', 'data-teinte'] });
  }

  /** Called by the shell whenever its tabs, the current page or the theme change. */
  configurerBarre(onglets: OngletNatif[], actifId: string | null, visible: boolean, surOnglet: (id: string, retouche: boolean) => void): void {
    if (!plugin) return;
    this.dernier = [onglets, actifId, visible, surOnglet];
    this.surOnglet = surOnglet;
    this.barreVoulue = visible;
    const o = { onglets, actif: actifId, visible: visible && !this.clavier && !this.feuille, sombre: this.root.dataset['theme'] === 'dark', couleurs: this.couleursBarre() };
    const cle = JSON.stringify(o);
    if (cle === this.barreEnvoyee) return;
    this.barreEnvoyee = cle;
    void plugin
      .configurerBarre(o)
      .then(({ hauteur }) => this.poserHauteur(hauteur))
      .catch((e) => console.error('Barre native', e));
  }

  /** The shell is gone (logout): nothing native stays on screen. */
  quitter(): void {
    if (!plugin) return;
    this.barreVoulue = false;
    this.surOnglet = null;
    this.dernier = null;
    this.barreEnvoyee = '';
    void plugin.afficherBarre({ visible: false });
    void plugin.configurerFab({ visible: false });
    this.fabConfig = '';
    this.poserHauteur(0);
  }

  private poserHauteur(h: number): void {
    this.hauteurBarre.set(h);
    if (h > 0) this.root.style.setProperty('--tb-nav-bas', `${h}px`);
    else this.root.style.removeProperty('--tb-nav-bas');
  }

  private estChamp(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el?.matches) return false;
    // Not a <select>: native list, no keyboard (installerSelects)
    if (el.matches('textarea, [contenteditable="true"]')) return true;
    return el.matches('input') && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes((el as HTMLInputElement).type);
  }

  private clavierOuvert(ouvert: boolean): void {
    if (!plugin || ouvert === this.clavier) return;
    this.clavier = ouvert;
    this.majVisibilite();
  }

  /** The bar and the button make room for the keyboard and for the sheets of the page. */
  private majVisibilite(): void {
    if (!plugin) return;
    if (this.barreVoulue) void plugin.afficherBarre({ visible: !this.clavier && !this.feuille });
    this.barreEnvoyee = '';
    this.fabConfig = '';
    this.planifierFab();
  }

  /**
   * A sheet of the page opens (a form: consigne, add, move…): it rises from the bottom of the
   * screen, where the native bar is drawn over the page; the bar steps aside while it is open,
   * as under a Material modal bottom sheet. Native menus (TbSheet menuNatif) are not concerned.
   */
  private suivreFeuilles(): void {
    const ouverte = !!this.doc.querySelector('.tb-scrim:not(.tb-sheet-natif):not(.tb-scrim-ferme)');
    if (ouverte === this.feuille) return;
    this.feuille = ouverte;
    this.majVisibilite();
  }

  // ---------------------------------------------------------------- <select>: native lists

  /**
   * The lists of the page (<select>) open as native Material lists (the same bottom sheet as the
   * menus, the current choice ticked) instead of the WebView's own popup. The page's <select>
   * no longer takes the touch (CSS: html.tb-selects-natifs); a tap on it opens the list.
   */
  private installerSelects(): void {
    this.root.classList.add('tb-selects-natifs');
    this.doc.addEventListener(
      'click',
      (e) => {
        const select = this.selectSous(e.clientX, e.clientY);
        if (!select) return;
        e.preventDefault();
        e.stopPropagation();
        void this.choisir(select);
      },
      true,
    );
    // Keyboard (or accessibility): Enter or Space on the list
    this.doc.addEventListener(
      'keydown',
      (e) => {
        if (!(e.target instanceof HTMLSelectElement) || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        void this.choisir(e.target);
      },
      true,
    );
  }

  private selectSous(x: number, y: number): HTMLSelectElement | null {
    for (const s of this.doc.querySelectorAll('select')) {
      if (s.disabled || !s.offsetParent) continue;
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  }

  private ouvertes = 0;
  private async choisir(select: HTMLSelectElement): Promise<void> {
    if (!natifMenu || this.ouvertes) return;
    const options = [...select.options].map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled && !o.hidden);
    if (!options.length) return;
    this.ouvertes++;
    try {
      const id = await natifMenu(
        this.libelleDe(select),
        '',
        options.map(({ o, i }) => ({ id: String(i), label: o.text.trim(), icone: '', danger: false, coche: o.selected })),
      );
      const i = id == null ? -1 : Number(id);
      if (i < 0 || i === select.selectedIndex) return;
      select.selectedIndex = i;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } finally {
      this.ouvertes--;
    }
  }

  /** Title of the list: its label, else its aria-label. */
  private libelleDe(select: HTMLSelectElement): string {
    const parId = select.id ? this.doc.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    const texte = parId?.textContent ?? select.closest('label')?.textContent ?? select.getAttribute('aria-label') ?? select.closest('.tb-field')?.querySelector('.tb-label')?.textContent ?? '';
    return texte.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- main action

  private image = 0;
  private planifierFab(): void {
    cancelAnimationFrame(this.image);
    this.image = requestAnimationFrame(() => this.majFab());
  }

  /** The page's main action (.tb-page-head > .tb-fab) becomes the native button. */
  private majFab(): void {
    if (!plugin) return;
    const web = this.doc.querySelector<HTMLElement>('.tb-page-head > .tb-fab');
    // Hidden while rows are ticked (Gestion), while typing, without the bar (landscape)
    const visible = !!web && !web.hasAttribute('disabled') && !this.clavier && !this.feuille && this.barreVoulue && !this.doc.querySelector('.tb-barre-on');
    const label = web?.textContent?.trim() ?? '';
    const icone = iconeNative(web?.querySelector('.pi')?.className ?? '');
    const config = `${visible}|${label}|${icone}|${this.root.dataset['theme']}|${this.root.dataset['ton'] ?? ''}`;
    this.fabCible = web;
    if (config === this.fabConfig) return;
    this.fabConfig = config;
    void plugin.configurerFab(visible ? { visible, label, icone, etendu: this.fabEtendu, couleurs: this.couleursFab() } : { visible: false });
  }

  /** Scrolling down shrinks the button to its icon, scrolling up brings its label back. */
  private surDefilement(): void {
    if (!plugin || !this.fabCible) return;
    const y = scrollY;
    const etendu = y < 40 ? true : y > this.dernierY + 8 ? false : y < this.dernierY - 8 ? true : this.fabEtendu;
    this.dernierY = y;
    if (etendu === this.fabEtendu) return;
    this.fabEtendu = etendu;
    void plugin.etendreFab({ etendu });
  }

  // ---------------------------------------------------------------- back button

  /**
   * Predictive back (Material 3): while the finger comes in from the edge, the page shrinks and
   * moves away from it (the bars stay); let go and it goes back, the salle page flowing back into
   * its dashboard card (TransitionsService) from where the finger left it; cancelled, it springs
   * back. Something open (sheet, full-screen chart) or nothing to go back to: no shrinking.
   */
  private surRetour(e: EtapeRetour): void {
    switch (e.etape) {
      case 'debut': {
        this.finirGeste(false);
        const page = !this.aFermer() && this.peutRevenir() && this.prefs.animer();
        const main = page ? this.doc.querySelector<HTMLElement>('.tb-main') : null;
        this.geste = { mode: main ? 'page' : 'autre', main, y0: e.y ?? innerHeight / 2 };
        if (main) {
          main.style.transition = 'none';
          main.style.transformOrigin = `50% ${scrollY + innerHeight * 0.5 - main.offsetTop}px`;
          this.root.classList.add('tb-geste-retour');
        }
        break;
      }
      case 'progres': {
        const main = this.geste?.main;
        if (!main) break;
        // Interpolated as Material's predictive back: up to 90 %, a little away from the edge,
        // following the finger up and down
        const p = recul(e.progres ?? 0);
        const sens = e.bord === 'droite' ? -1 : 1;
        const dy = Math.max(-1, Math.min(1, ((e.y ?? this.geste!.y0) - this.geste!.y0) / innerHeight));
        main.style.transform = `translate(${sens * p * Math.max(0, innerWidth / 20 - 8)}px, ${dy * p * innerHeight * 0.05}px) scale(${1 - p * 0.1})`;
        break;
      }
      case 'annule':
        this.finirGeste(true);
        break;
      case 'valide': {
        const main = this.geste?.mode === 'page' ? this.geste.main : null;
        this.geste = null;
        if (main?.style.transform) {
          // Goes back from where the page is: the transition takes its picture there, the page is
          // put straight once the next one is in place (before its picture)
          this.router.events
            .pipe(
              filter((ev) => ev instanceof NavigationEnd || ev instanceof NavigationCancel || ev instanceof NavigationError),
              take(1),
            )
            .subscribe(() => this.transitions.apresMaj(() => this.remettre(main, false)));
          setTimeout(() => this.remettre(main, false), 1500);
        } else if (main) {
          this.remettre(main, false);
        }
        this.retour();
        break;
      }
    }
  }

  private finirGeste(ressort: boolean): void {
    const main = this.geste?.main;
    this.geste = null;
    if (main) this.remettre(main, ressort);
  }

  private remettre(main: HTMLElement, ressort: boolean): void {
    const finir = () => {
      main.style.transition = '';
      main.style.transformOrigin = '';
      this.root.classList.remove('tb-geste-retour');
    };
    if (!main.style.transform) {
      finir();
      return;
    }
    main.style.transition = ressort ? 'transform .35s cubic-bezier(.2, 0, 0, 1)' : 'none';
    main.style.transform = '';
    if (ressort) setTimeout(finir, 360);
    else finir();
  }

  /** Something the back closes before going back. */
  private aFermer(): boolean {
    return !!this.doc.querySelector('.tb-scrim:not(.tb-scrim-ferme), .tb-graphique-plein .tb-lecture-plein');
  }

  private peutRevenir(): boolean {
    const etat = history.state as { navigationId?: number } | null;
    return !!etat?.navigationId && etat.navigationId > 1;
  }

  /** Android back: closes what is open, else goes back, else puts the app in the background. */
  private retour(): void {
    const scrim = this.doc.querySelector<HTMLElement>('.tb-scrim');
    if (scrim) {
      scrim.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const plein = this.doc.querySelector<HTMLElement>('.tb-graphique-plein .tb-lecture-plein');
    if (plein) {
      plein.click();
      return;
    }
    if (this.peutRevenir()) history.back();
    else void App.minimizeApp();
  }

  // ---------------------------------------------------------------- colours of the theme

  private couleursBarre(): CouleursBarre {
    return {
      fond: this.hex('--tb-m3-container', '--md-surface-container'),
      normal: this.hex('--md-on-surface-variant'),
      actif: this.hex('--tb-m3-on-indicateur', '--md-on-secondary-container'),
      indicateur: this.hex('--tb-m3-indicateur', '--md-secondary-container'),
      badge: this.hex('--md-error'),
    };
  }

  private couleursFab(): { fond: string; texte: string } {
    return { fond: this.hex('--md-primary-container'), texte: this.hex('--md-on-primary-container') };
  }

  private hex(...vars: string[]): string {
    return hex(...vars);
  }
}

/** Progress of the gesture as Material eases it: quick at first, then slower. */
function recul(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - x, 2);
}
