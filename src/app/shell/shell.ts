import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthService } from '../core/auth';
import { AvisMajService } from '../core/avis-maj';
import { ClavierService } from '../core/clavier';
import { ActiviteService } from '../core/http';
import { PlateformeService } from '../core/plateforme';
import { PreferencesService } from '../core/preferences';
import { TitreService } from '../core/titre';
import { ReglagesService } from '../services/reglages.service';
import { TbSheet } from '../ui/sheet';

interface Destination {
  lien: string;
  icone: string;
  label: string;
  /** Also active on these pages (a salle belongs to « Salles »). */
  aussi?: string[];
  badge?: boolean;
}

/**
 * Frame of every page of a logged-in user (layout.xhtml of the JSF interface): top bar on
 * phones, navigation rail on wide screens or bar at the bottom of phones, the page in between.
 *
 * Same markup everywhere; the platform (PlateformeService) restyles it: Liquid Glass on iOS,
 * Material 3 on Android, the ThermoBox glass on the web. On an iOS or Android phone, more than five
 * destinations don't fit in the bar: the last ones go behind « Plus », as native apps do.
 */
@Component({
  selector: 'tb-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TbSheet],
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

  private readonly dests = viewChild<ElementRef<HTMLElement>>('dests');

  protected readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly destinations = computed<Destination[]>(() => {
    const d: Destination[] = [
      { lien: '/app/apercu', icone: 'pi-th-large', label: 'Aperçu' },
      { lien: '/app/salles', icone: 'pi-building', label: 'Salles', aussi: ['/app/salle/'] },
      { lien: '/app/mesures', icone: 'pi-chart-line', label: 'Mesures' },
    ];
    if (this.auth.gestionnaire()) d.push({ lien: '/app/gestion', icone: 'pi-sliders-h', label: 'Gérer' });
    if (this.auth.admin()) {
      d.push({ lien: '/app/utilisateurs', icone: 'pi-users', label: 'Utilisateurs' });
      d.push({ lien: '/app/mises-a-jour', icone: 'pi-cloud-download', label: 'Mises à jour', badge: true });
    }
    return d;
  });

  /** iOS and Android phones: at most five places in the bar, the fifth being « Plus ». */
  protected readonly avecPlus = computed(() => (this.plateforme.ios || this.plateforme.android) && this.destinations().length > 5);
  protected readonly nbDansBarre = computed(() => (this.avecPlus() ? 4 : this.destinations().length));
  /** The current page is one of those behind « Plus ». */
  protected readonly plusActif = computed(() =>
    this.avecPlus() && this.destinations().slice(this.nbDansBarre()).some((d) => this.estActive(d)),
  );

  protected readonly plus = signal(false);
  protected readonly railOuvert = signal(false);

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

  constructor() {
    // The lens of the iOS tab bar follows the selected destination
    afterRenderEffect(() => {
      this.url();
      this.destinations();
      this.placerLentille();
    });
  }

  ngOnInit(): void {
    addEventListener('scroll', this.surDefilement, { passive: true });
    addEventListener('resize', this.surRedimension, { passive: true });
    this.reglages.charger().subscribe({ error: () => undefined });
    void this.avis.verifier();
    void this.auth.rafraichirUtilisateur().catch(() => undefined);
    this.minuterie = setInterval(() => void this.avis.verifier(), 3_600_000);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.plus.set(false);
      this.railOuvert.set(false);
      this.compact.set(false);
      setTimeout(() => this.mesurerDefilement(), 50);
    });
  }

  ngOnDestroy(): void {
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

  protected basculerTheme(e: Event): void {
    this.prefs.basculerTheme(e.currentTarget as HTMLElement);
  }

  protected deconnecter(): void {
    this.plus.set(false);
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

  protected placerLentille(): void {
    const dests = this.dests()?.nativeElement;
    if (!dests) return;
    const actif = dests.querySelector<HTMLElement>('.tb-dest.tb-dest-on:not([hidden])');
    const visible = actif && actif.offsetParent !== null && getComputedStyle(actif).display !== 'none';
    dests.classList.toggle('tb-a-actif', !!visible);
    if (!actif || !visible) return;
    dests.style.setProperty('--tb-l-x', `${actif.offsetLeft}px`);
    dests.style.setProperty('--tb-l-y', `${actif.offsetTop}px`);
    dests.style.setProperty('--tb-l-w', `${actif.offsetWidth}px`);
    dests.style.setProperty('--tb-l-h', `${actif.offsetHeight}px`);
  }
}
