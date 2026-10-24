import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AndroidNatifService, OngletNatif, iconeNative } from '../core/android-natif';
import { AuthService } from '../core/auth';
import { AvisMajService } from '../core/avis-maj';
import { ClavierService } from '../core/clavier';
import { ActiviteService } from '../core/http';
import { PlateformeService } from '../core/plateforme';
import { PreferencesService } from '../core/preferences';
import { TitreService } from '../core/titre';
import { TransitionsService } from '../core/transitions';
import { ReglagesService } from '../services/reglages.service';
import { TbComptes } from '../ui/comptes';
import { TbSheet } from '../ui/sheet';
import { Destination, dernierOnglet, destinationsDe, placesBarre } from './destinations';

/** The lens follows the finger once held this long (ms), or as soon as the finger slides. */
const APPUI_LONG = 220;
const GLISSE = 8;

/**
 * Frame of every page of a logged-in user (layout.xhtml of the JSF interface): navigation rail on
 * wide screens, bar at the bottom of phones with the top bar above the page, the page in between.
 * The top bar holds no action: the account and the other pages are behind the last tab (« Plus »,
 * or « Compte » when every page fits in the bar), as in native apps.
 *
 * Same markup everywhere; the platform (PlateformeService) restyles it: Liquid Glass on iOS,
 * Material 3 on Android, the ThermoBox glass on the web.
 *
 * iOS: the lens of the tab bar can be held and slid from tab to tab, as in iOS 26; letting go
 * opens the tab under it.
 */
@Component({
  selector: 'tb-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TbSheet, TbComptes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  host: {
    class: 'tb-shell',
    '[class.tb-defile]': 'defile()',
    '[class.tb-defile-titre]': 'titreCache()',
    '[class.tb-compact]': 'compact()',
  },
})
export class Shell implements OnInit, OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly plateforme = inject(PlateformeService);
  protected readonly avis = inject(AvisMajService);
  protected readonly activite = inject(ActiviteService);
  protected readonly titre = inject(TitreService);
  protected readonly clavier = inject(ClavierService);
  private readonly reglages = inject(ReglagesService);
  private readonly transitions = inject(TransitionsService);

  private readonly dests = viewChild<ElementRef<HTMLElement>>('dests');

  protected readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** « Maison » look: the words and the short bar of a home. */
  protected readonly maison = computed(() => this.prefs.style() !== 'panneau');
  protected readonly destinations = computed(() => destinationsDe(this.auth, this.maison()));
  /** Places of the bar of phones before « Plus ». */
  protected readonly dansBarre = computed(() => placesBarre(this.maison()));
  /** Some pages only fit behind the last tab: it is « Plus » rather than « Compte ». */
  protected readonly avecPlus = computed(() => this.destinations().length > this.dansBarre());
  protected readonly dernier = computed(() => dernierOnglet(this.maison(), this.avecPlus()));
  /** Phone held upright: the bar at the bottom, the last pages behind « Plus ». */
  protected readonly barreBas = this.plateforme.barreBas;

  /** « Plus » / « Compte » is the current tab. */
  protected readonly plusActif = computed(() => {
    const url = this.url().split('?')[0];
    if (['/app/plus', '/app/profil', '/app/preferences', '/app/a-propos'].some((u) => url.startsWith(u))) return true;
    return this.barreBas() && this.destinations().slice(this.dansBarre()).some((d) => this.estActive(d));
  });

  // Scrolling (iOS / Android bars)
  protected readonly defile = signal(false);
  protected readonly titreCache = signal(false);
  protected readonly compact = signal(false);
  private dernierY = 0;
  private image = 0;
  private readonly surDefilement = () => {
    cancelAnimationFrame(this.image);
    this.image = requestAnimationFrame(() => this.mesurerDefilement());
  };
  private readonly surRedimension = () => this.placerLentille();
  private minuterie?: ReturnType<typeof setInterval>;

  // Lens held (iOS)
  protected readonly saisie = signal(false);
  /** « Changer de compte » (rail of wide screens; on phones: the Plus page). */
  protected readonly comptes = signal(false);
  /** Tab under the held lens. */
  protected readonly survolee = signal<string | null>(null);
  private appui: { id: number; x: number; t: number; dx: number; vx: number; minuterie: ReturnType<typeof setTimeout> } | null = null;
  /** The click that ends a slide of the lens must not open the tab it started on. */
  private ignorerClic = false;

  /** Android app: the bar at the bottom is the native Material 3 one (core/android-natif.ts). */
  private readonly natif = inject(AndroidNatifService);

  constructor() {
    if (this.natif.actif) {
      effect(() => {
        const dests = this.destinations();
        const onglets: OngletNatif[] = dests.slice(0, this.dansBarre()).map((d) => ({
          id: d.lien,
          label: d.label,
          icone: iconeNative(d.icone),
          badge: !!d.badge && this.avis.disponible(),
        }));
        onglets.push({
          id: '/app/plus',
          label: this.dernier().label,
          icone: this.dernier().natif,
          badge: this.avecPlus() && this.avis.disponible(),
        });
        const actif = dests.slice(0, this.dansBarre()).find((d) => this.estActive(d))?.lien ?? (this.plusActif() ? '/app/plus' : null);
        this.prefs.theme();
        // Phone held sideways: the rail of the page, not the bar
        this.natif.configurerBarre(onglets, actif, this.barreBas(), (id, retouche) => {
          // The tab again: back to its first page (« Plus » from À propos, Salles from a
          // salle…), as the web bar does; already there, back to the top
          const ici = this.router.url.split(/[?#]/)[0];
          if (retouche && ici === id) scrollTo({ top: 0, behavior: this.prefs.animer() ? 'smooth' : 'auto' });
          else void this.router.navigateByUrl(id);
        });
      });
    }
    // The lens of the iOS tab bar follows the selected destination
    afterRenderEffect(() => {
      this.url();
      this.destinations();
      this.barreBas();
      this.placerLentille();
    });
  }

  ngOnInit(): void {
    // Capture phase: before the routerLink of the tab the slide started on
    queueMicrotask(() => this.dests()?.nativeElement.addEventListener('click', (e) => this.surClicBarre(e), true));
    addEventListener('scroll', this.surDefilement, { passive: true });
    addEventListener('resize', this.surRedimension, { passive: true });
    this.reglages.charger().subscribe({ error: () => undefined });
    void this.avis.verifier();
    void this.auth.rafraichirUtilisateur().catch(() => undefined);
    this.minuterie = setInterval(() => void this.avis.verifier(), 3_600_000);
    this.transitions.sansTransition();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.compact.set(false);
      this.transitions.sansTransition();
      setTimeout(() => this.mesurerDefilement(), 50);
    });
  }

  ngOnDestroy(): void {
    this.natif.quitter();
    removeEventListener('scroll', this.surDefilement);
    removeEventListener('resize', this.surRedimension);
    clearInterval(this.minuterie);
  }

  protected estActive(d: Destination): boolean {
    const url = this.url().split('?')[0];
    return url.startsWith(d.lien) || (d.aussi ?? []).some((a) => url.startsWith(a));
  }

  protected surDestination(): void {
    this.plateforme.vibrer();
  }

  protected deconnecter(): void {
    void this.auth.logout();
  }

  private mesurerDefilement(): void {
    const y = scrollY;
    this.defile.set(y > 4);
    const barre = this.doc.querySelector('.tb-topbar')?.getBoundingClientRect().bottom ?? 0;
    const h1 = this.doc.querySelector('.tb-page-title h1');
    this.titreCache.set(!!h1 && h1.getBoundingClientRect().bottom < barre + 4);
    // iOS: the tab bar shrinks while scrolling down, comes back when scrolling up
    if (this.plateforme.ios) {
      if (y < 40) this.compact.set(false);
      else if (y > this.dernierY + 6) this.compact.set(true);
      else if (y < this.dernierY - 6) this.compact.set(false);
    }
    this.dernierY = y;
  }

  /** Tabs shown in the bar, in order. */
  private onglets(dests: HTMLElement): HTMLElement[] {
    return [...dests.querySelectorAll<HTMLElement>('.tb-dest')].filter((t) => t.offsetParent !== null && getComputedStyle(t).display !== 'none');
  }

  protected placerLentille(): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || this.saisie()) return;
    const actif = dests.querySelector<HTMLElement>('.tb-dest.tb-dest-on');
    const visible = !!actif && actif.offsetParent !== null && getComputedStyle(actif).display !== 'none';
    dests.classList.toggle('tb-a-actif', visible);
    // Bar of phones: the lens is placed in tabs (index, count), not in pixels, so it stays on its
    // tab whatever the bar does (shrinking while scrolling, rotation…)
    dests.classList.toggle('tb-lentille-rel', this.barreBas());
    if (!actif || !visible) return;
    if (this.barreBas()) {
      const tabs = this.onglets(dests);
      dests.style.setProperty('--tb-l-n', `${tabs.length}`);
      dests.style.setProperty('--tb-l-i', `${tabs.indexOf(actif)}`);
      return;
    }
    this.poserLentille(dests, actif.offsetLeft, actif.offsetTop, actif.offsetWidth, actif.offsetHeight);
  }

  private poserLentille(dests: HTMLElement, x: number, y: number, w: number, h: number): void {
    dests.style.setProperty('--tb-l-x', `${x}px`);
    dests.style.setProperty('--tb-l-y', `${y}px`);
    dests.style.setProperty('--tb-l-w', `${w}px`);
    dests.style.setProperty('--tb-l-h', `${h}px`);
  }

  // ---------------------------------------------------------------- lens held and slid (iOS)

  protected debutAppui(e: PointerEvent): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || !this.plateforme.ios || !this.barreBas() || e.button !== 0) return;
    if (!(e.target as Element).closest('.tb-dest')) return;
    this.finAppui();
    this.appui = {
      id: e.pointerId,
      x: e.clientX,
      t: e.timeStamp,
      dx: 0,
      vx: 0,
      minuterie: setTimeout(() => this.saisir(e.clientX), APPUI_LONG),
    };
    dests.addEventListener('pointermove', this.surGlisse);
    dests.addEventListener('pointerup', this.surLacher);
    dests.addEventListener('pointercancel', this.surAnnuler);
  }

  private readonly surGlisse = (e: PointerEvent) => {
    const a = this.appui;
    if (!a || e.pointerId !== a.id) return;
    const dt = Math.max(1, e.timeStamp - a.t);
    a.vx = (e.clientX - a.x - a.dx) / dt;
    a.dx = e.clientX - a.x;
    a.t = e.timeStamp;
    if (!this.saisie() && Math.abs(a.dx) > GLISSE) this.saisir(e.clientX);
    if (this.saisie()) this.suivre(e.clientX, a.vx);
  };

  private readonly surLacher = (e: PointerEvent) => {
    if (!this.appui || e.pointerId !== this.appui.id) return;
    const lien = this.saisie() ? this.survolee() : null;
    this.finAppui();
    if (!lien) return;
    this.ignorerClic = true;
    setTimeout(() => (this.ignorerClic = false), 400);
    this.plateforme.vibrer();
    if (this.router.url.split('?')[0] !== lien) void this.router.navigateByUrl(lien);
  };

  private readonly surAnnuler = () => this.finAppui();

  /** The lens lifts off the bar and follows the finger. */
  private saisir(x: number): void {
    const dests = this.dests()?.nativeElement;
    if (!dests || !this.appui || this.saisie()) return;
    clearTimeout(this.appui.minuterie);
    try {
      dests.setPointerCapture(this.appui.id);
    } catch {
      /* pointer already gone */
    }
    dests.classList.add('tb-a-actif');
    this.saisie.set(true);
    this.plateforme.vibrer();
    this.suivre(x, 0);
  }

  private suivre(x: number, vitesse: number): void {
    const dests = this.dests()?.nativeElement;
    if (!dests) return;
    const tabs = this.onglets(dests);
    if (!tabs.length) return;
    const boite = dests.getBoundingClientRect();
    const n = tabs.length;
    // Position in tabs, between two while it slides
    const i = Math.min(Math.max((x - boite.left) / (boite.width / n) - 0.5, 0), n - 1);
    dests.style.setProperty('--tb-l-n', `${n}`);
    dests.style.setProperty('--tb-l-i', `${i}`);
    // Stretched in the direction it moves, like a drop
    dests.style.setProperty('--tb-l-etire', `${Math.min(0.18, Math.abs(vitesse) * 0.12)}`);
    const lien = tabs[Math.round(i)].dataset['lien'] ?? null;
    if (lien !== this.survolee()) {
      if (this.survolee() != null) this.plateforme.vibrer();
      this.survolee.set(lien);
    }
  }

  private finAppui(): void {
    const dests = this.dests()?.nativeElement;
    if (this.appui) clearTimeout(this.appui.minuterie);
    this.appui = null;
    dests?.removeEventListener('pointermove', this.surGlisse);
    dests?.removeEventListener('pointerup', this.surLacher);
    dests?.removeEventListener('pointercancel', this.surAnnuler);
    dests?.style.setProperty('--tb-l-etire', '0');
    if (this.saisie()) {
      this.saisie.set(false);
      this.survolee.set(null);
      // Back on the current tab (or the next one, once the page changes)
      requestAnimationFrame(() => this.placerLentille());
    }
  }

  private surClicBarre(e: MouseEvent): void {
    if (!this.ignorerClic) return;
    e.preventDefault();
    e.stopPropagation();
    this.ignorerClic = false;
  }
}
