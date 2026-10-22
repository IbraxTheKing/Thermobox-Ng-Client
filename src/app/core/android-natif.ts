import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

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
  menu(o: { titre: string; sousTitre: string; options: { id: string; label: string; icone: string; danger: boolean }[]; couleurs: { fond: string; texte: string; texteSecondaire: string; danger: string } }): Promise<{ id: string | null }>;
  addListener(e: 'onglet', f: (d: { id: string; retouche: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'fab', f: () => void): Promise<PluginListenerHandle>;
  addListener(e: 'hauteur', f: (d: { hauteur: number; visible: boolean }) => void): Promise<PluginListenerHandle>;
}

/** Composants natifs Material 3 (plugins/thermobox-natif), dans l'application Android seulement. */
export const ANDROID_NATIF = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

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
  ? async (titre: string, sousTitre: string, options: { id: string; label: string; icone: string; danger: boolean }[]) =>
      (
        await plugin.menu({
          titre,
          sousTitre,
          options: options.map((o) => ({ ...o, icone: iconeNative(o.icone, 'ouvrir') })),
          couleurs: {
            fond: hex('--tb-m3-container-high', '--md-surface-container-high'),
            texte: hex('--md-on-surface'),
            texteSecondaire: hex('--md-on-surface-variant'),
            danger: hex('--md-error'),
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
  readonly actif = ANDROID_NATIF;

  /** Hauteur de la barre native en px CSS (0 : cachée). */
  readonly hauteurBarre = signal(0);
  private clavier = false;
  private barreVoulue = false;
  private fabCible: HTMLElement | null = null;
  private fabConfig = '';
  private fabEtendu = true;
  private dernierY = 0;
  private surOnglet: ((id: string, retouche: boolean) => void) | null = null;
  private dernier: Parameters<AndroidNatifService['configurerBarre']> | null = null;

  constructor() {
    if (!plugin) return;
    this.root.classList.add('tb-android-natif');
    void plugin.addListener('onglet', ({ id, retouche }) => this.surOnglet?.(id, retouche));
    void plugin.addListener('fab', () => this.fabCible?.click());
    void plugin.addListener('hauteur', ({ hauteur }) => this.poserHauteur(hauteur));
    void App.addListener('backButton', () => this.retour());

    // Keyboard open (a field has the focus): the bar and the button make room
    this.doc.addEventListener('focusin', (e) => {
      if (this.estChamp(e.target)) this.clavierOuvert(true);
    });
    this.doc.addEventListener('focusout', () => setTimeout(() => this.clavierOuvert(this.estChamp(this.doc.activeElement)), 50));

    // The main action of each page: follows the page (and its tabs, its selection mode…)
    new MutationObserver(() => this.planifierFab()).observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
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
    void plugin
      .configurerBarre({ onglets, actif: actifId, visible: visible && !this.clavier, sombre: this.root.dataset['theme'] === 'dark', couleurs: this.couleursBarre() })
      .then(({ hauteur }) => this.poserHauteur(hauteur))
      .catch((e) => console.error('Barre native', e));
  }

  /** The shell is gone (logout): nothing native stays on screen. */
  quitter(): void {
    if (!plugin) return;
    this.barreVoulue = false;
    this.surOnglet = null;
    this.dernier = null;
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
    if (el.matches('textarea, select, [contenteditable="true"]')) return true;
    return el.matches('input') && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes((el as HTMLInputElement).type);
  }

  private clavierOuvert(ouvert: boolean): void {
    if (!plugin || ouvert === this.clavier) return;
    this.clavier = ouvert;
    if (this.barreVoulue) void plugin.afficherBarre({ visible: !ouvert });
    this.fabConfig = '';
    this.planifierFab();
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
    const visible = !!web && !web.hasAttribute('disabled') && !this.clavier && this.barreVoulue && !this.doc.querySelector('.tb-barre-on');
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
    const etat = history.state as { navigationId?: number } | null;
    if (etat?.navigationId && etat.navigationId > 1) history.back();
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
