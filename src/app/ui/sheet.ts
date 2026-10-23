import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { natifMenu } from '../core/android-natif';

let suivant = 0;

/** Sheets open at once (one may open while another closes): the page scrolls again at 0. */
let verrous = 0;
function verrouiller(doc: Document): void {
  if (verrous++ === 0) doc.body.style.overflow = 'hidden';
}
function liberer(doc: Document): void {
  verrous = Math.max(0, verrous - 1);
  if (verrous === 0) doc.body.style.overflow = '';
}

/** Longest closing animation (controls.css): past it, the sheet is gone even without animationend. */
const DUREE_FERMETURE = 320;

/**
 * A dialog (p:dialog): centred on wide screens, a sheet from the bottom of the screen on phones,
 * restyled per platform (iOS: floating glass sheet; Android: Material bottom sheet). Closes with
 * Échap, a tap outside, the × (wide screens only) or by dragging the sheet down: on a phone, the
 * grabber and the « Annuler » of the form say it, as in native apps.
 *
 * While open, the page under it does not scroll; that lock is always given back, also when the
 * sheet goes away with its page (an action of the sheet that opens another page).
 *
 * [menuNatif]: in the Android app, a sheet that is a menu (a head and .tb-sheet-item rows) opens
 * as a native Material bottom sheet, built from those rows; picking one clicks it. A row marked
 * data-natif-web opens the web sheet instead (for what only the page can show: a form…).
 *
 *   <tb-sheet [(ouvert)]="dialogue" titre="Ajouter">…<div class="tb-actions">…</div></tb-sheet>
 */
@Component({
  selector: 'tb-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="tb-scrim" [class.tb-scrim-ferme]="fermeture()" [class.tb-sheet-natif]="enNatif()" (pointerdown)="surFond($event)" (keydown.escape)="fermer()">
        <section
          #boite
          class="tb-dialog"
          [class.tb-closing]="fermeture()"
          [style.--tb-dialog-w.px]="largeur()"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="idTitre"
          [attr.aria-hidden]="enNatif() ? true : null"
          tabindex="-1"
          (animationend)="finAnimation($event)"
          (pointerdown)="debutGlisse($event)"
        >
          <div class="tb-grabber" aria-hidden="true"></div>
          @if (titre() || !sansEntete()) {
            <header class="tb-dialog-head">
              <h2 [id]="idTitre">{{ titre() }}</h2>
              <button type="button" class="tb-btn tb-icon tb-flat tb-dialog-fermer" (click)="fermer()" title="Fermer" aria-label="Fermer">
                <i class="pi pi-times"></i>
              </button>
            </header>
          }
          <div class="tb-dialog-body">
            <ng-content />
          </div>
        </section>
      </div>
    }
  `,
})
export class TbSheet {
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  readonly ouvert = model(false);
  readonly titre = input('');
  readonly largeur = input(440);
  readonly sansEntete = input(false, { transform: booleanAttribute });
  /** Android app: a native Material menu built from the .tb-sheet-item rows. */
  readonly menuNatif = input(false, { transform: booleanAttribute });

  protected readonly idTitre = `tb-sheet-titre-${++suivant}`;
  protected readonly visible = signal(false);
  protected readonly fermeture = signal(false);
  /** Shown as a native menu: the web sheet is there (its rows are clicked) but not seen. */
  protected readonly enNatif = signal(false);
  private readonly boite = viewChild<ElementRef<HTMLElement>>('boite');
  private focusAvant: HTMLElement | null = null;
  private glisse: { y: number; dy: number; t: number } | null = null;
  private verrouillee = false;
  private minuterie?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const ouvert = this.ouvert();
      untracked(() => (ouvert ? this.ouvrir() : this.visible() && this.commencerFermeture()));
    });
    // Gone with its page (an action of the sheet opened another one): the page scrolls again
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.minuterie);
      this.deverrouiller();
    });
  }

  fermer(): void {
    this.ouvert.set(false);
  }

  private ouvrir(): void {
    clearTimeout(this.minuterie);
    this.focusAvant = this.doc.activeElement as HTMLElement | null;
    this.fermeture.set(false);
    const natif = this.menuNatif() && !!natifMenu;
    this.enNatif.set(natif);
    this.visible.set(true);
    if (natif) {
      afterNextRender({ read: () => void this.menuNatifOuvrir() }, { injector: this.injector });
      return;
    }
    this.verrouiller();
    afterNextRender({ read: () => this.boite()?.nativeElement.focus({ preventScroll: true }) }, { injector: this.injector });
  }

  private commencerFermeture(): void {
    if (this.enNatif()) {
      this.terminer();
      return;
    }
    this.fermeture.set(true);
    // Closed even if the animation does not end (reduced motion, page hidden…)
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.terminer(), DUREE_FERMETURE);
  }

  protected finAnimation(e: AnimationEvent): void {
    // Only the sheet's own closing animation (its content has animations of its own)
    if (e.target !== e.currentTarget || !this.fermeture()) return;
    this.terminer();
  }

  private terminer(): void {
    clearTimeout(this.minuterie);
    if (!this.visible()) return;
    this.visible.set(false);
    this.fermeture.set(false);
    this.enNatif.set(false);
    this.deverrouiller();
    if (this.focusAvant?.isConnected) this.focusAvant.focus?.({ preventScroll: true });
  }

  private verrouiller(): void {
    if (this.verrouillee) return;
    this.verrouillee = true;
    verrouiller(this.doc);
  }

  private deverrouiller(): void {
    if (!this.verrouillee) return;
    this.verrouillee = false;
    liberer(this.doc);
  }

  protected surFond(e: PointerEvent): void {
    if (e.target === e.currentTarget) this.fermer();
  }

  // ---------------------------------------------------------------- native menu (Android app)

  private async menuNatifOuvrir(): Promise<void> {
    const boite = this.boite()?.nativeElement;
    if (!boite || !natifMenu) return;
    const items = [...boite.querySelectorAll<HTMLElement>('.tb-sheet-item')];
    if (!items.length) {
      // Not a menu after all: the web sheet
      this.versWeb();
      return;
    }
    const tete = boite.querySelector('.tb-sheet-head, [data-menu-tete]');
    const titre = this.titre() || tete?.querySelector('strong')?.textContent?.trim() || '';
    const sousTitre = (boite.querySelector('[data-menu-sous-titre]') ?? tete?.querySelector('.tb-muted'))?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const choix = await natifMenu(
      titre,
      sousTitre,
      items.map((el, i) => ({
        id: String(i),
        label: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        icone: el.querySelector('.pi')?.className ?? '',
        danger: el.classList.contains('tb-sheet-danger'),
      })),
    );
    if (!this.visible() || !this.enNatif()) return;
    const el = choix == null ? null : items[+choix];
    if (el?.hasAttribute('data-natif-web')) {
      this.versWeb();
      return;
    }
    el?.click();
    this.fermer();
  }

  /** The web sheet itself, after all. */
  private versWeb(): void {
    this.enNatif.set(false);
    this.verrouiller();
  }

  // ---------------------------------------------------------------- swipe down to close

  /** Phones: dragging the sheet down from its top closes it. */
  protected debutGlisse(e: PointerEvent): void {
    const boite = this.boite()?.nativeElement;
    if (!boite || e.pointerType === 'mouse' || innerWidth > 640) return;
    const corps = boite.querySelector('.tb-dialog-body');
    if (corps && corps.scrollTop > 0) return;
    if ((e.target as HTMLElement).closest('input, select, textarea, button, a, label')) return;
    this.glisse = { y: e.clientY, dy: 0, t: Date.now() };
    const bouger = (ev: PointerEvent) => {
      if (!this.glisse) return;
      this.glisse.dy = Math.max(0, ev.clientY - this.glisse.y);
      boite.style.transform = `translateY(${this.glisse.dy}px)`;
    };
    const lacher = () => {
      this.doc.removeEventListener('pointermove', bouger);
      this.doc.removeEventListener('pointerup', lacher);
      this.doc.removeEventListener('pointercancel', lacher);
      const g = this.glisse;
      this.glisse = null;
      if (!g) return;
      const rapide = g.dy > 40 && Date.now() - g.t < 250;
      boite.style.transition = 'transform .25s ease';
      if (g.dy > boite.offsetHeight / 3 || rapide) {
        boite.style.transform = 'translateY(100%)';
        setTimeout(() => {
          boite.style.transition = '';
          boite.style.transform = '';
          this.ouvert.set(false);
          this.terminer();
        }, 250);
      } else {
        boite.style.transform = '';
        setTimeout(() => (boite.style.transition = ''), 250);
      }
    };
    this.doc.addEventListener('pointermove', bouger);
    this.doc.addEventListener('pointerup', lacher);
    this.doc.addEventListener('pointercancel', lacher);
  }
}
