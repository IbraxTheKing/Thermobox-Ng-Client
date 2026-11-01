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
      <div class="tb-scrim" [class.tb-scrim-ferme]="fermeture()" [class.tb-sheet-natif]="enNatif()" (pointerdown)="appuiFond($event)" (click)="clicFond($event)" (keydown.escape)="fermer()">
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
          (touchstart)="debutGlisse($event)"
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
  /** The touch that began on the dark background around the sheet. */
  private fondTouche = false;
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

  /**
   * A tap outside the sheet only closes it. Closed on the click, not on the press: closing as the
   * finger touched let the end of that same tap go through to whatever was under the sheet.
   */
  protected appuiFond(e: PointerEvent): void {
    this.fondTouche = e.target === e.currentTarget;
  }

  protected clicFond(e: MouseEvent): void {
    const dehors = this.fondTouche && e.target === e.currentTarget;
    this.fondTouche = false;
    if (!dehors) return;
    e.preventDefault();
    e.stopPropagation();
    this.fermer();
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

  /**
   * Phones: the whole sheet follows the finger down, from anywhere on it (its rows and buttons
   * too: the tap that started the drag is then not a tap), as long as what is under the finger is
   * scrolled to its top. Let go far or fast enough and it closes; else it springs back.
   */
  protected debutGlisse(e: TouchEvent): void {
    const boite = this.boite()?.nativeElement;
    if (!boite || e.touches.length !== 1 || innerWidth > 640) return;
    const cible = e.target as HTMLElement;
    // What takes the finger itself: a slider, text being selected, a chart
    if (cible.closest('input[type="range"], textarea, .tb-graphique, [data-sans-geste]')) return;
    // Something scrolled under the finger scrolls back up first
    for (let el: HTMLElement | null = cible; el && el !== boite.parentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return;
    }
    const t0 = e.touches[0];
    const g: { x: number; y: number; dy: number; t: number; vy: number; mode: '?' | 'oui' | 'non' } = { x: t0.clientX, y: t0.clientY, dy: 0, t: e.timeStamp, vy: 0, mode: '?' };

    const bouger = (ev: TouchEvent) => {
      const t = ev.touches[0];
      const dy = t.clientY - g.y;
      if (g.mode === '?') {
        if (Math.hypot(t.clientX - g.x, dy) < 8) return;
        g.mode = dy > 0 && Math.abs(dy) > Math.abs(t.clientX - g.x) ? 'oui' : 'non';
        if (g.mode === 'non') {
          finir();
          return;
        }
        boite.style.transition = 'none';
        // Not a tap on the row the finger started on
        (this.doc.activeElement as HTMLElement | null)?.blur?.();
      }
      ev.preventDefault();
      const dt = Math.max(1, ev.timeStamp - g.t);
      g.vy = (Math.max(0, dy) - g.dy) / dt;
      g.dy = Math.max(0, dy);
      g.t = ev.timeStamp;
      boite.style.transform = `translateY(${g.dy}px)`;
    };
    const lacher = () => {
      finir();
      if (g.mode !== 'oui') return;
      // The click that ends the drag must not press the button under the finger
      const avaler = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      this.doc.addEventListener('click', avaler, true);
      setTimeout(() => this.doc.removeEventListener('click', avaler, true), 350);
      boite.style.transition = 'transform .28s cubic-bezier(.2, 0, 0, 1)';
      if (g.dy > boite.offsetHeight / 3 || g.vy > 0.6) {
        boite.style.transform = 'translateY(105%)';
        setTimeout(() => {
          boite.style.transition = '';
          boite.style.transform = '';
          this.ouvert.set(false);
          this.terminer();
        }, 260);
      } else {
        boite.style.transform = '';
        setTimeout(() => (boite.style.transition = ''), 280);
      }
    };
    const finir = () => {
      this.doc.removeEventListener('touchmove', bouger);
      this.doc.removeEventListener('touchend', lacher);
      this.doc.removeEventListener('touchcancel', lacher);
    };
    this.doc.addEventListener('touchmove', bouger, { passive: false });
    this.doc.addEventListener('touchend', lacher);
    this.doc.addEventListener('touchcancel', lacher);
  }
}
