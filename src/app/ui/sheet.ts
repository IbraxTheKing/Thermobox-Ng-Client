import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  booleanAttribute,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

let suivant = 0;

/**
 * A dialog (p:dialog): centred on wide screens, a sheet from the bottom of the screen on phones,
 * restyled per platform (iOS: floating glass sheet; Android: Material bottom sheet). Closes with
 * Échap, a tap outside, the × (wide screens only) or by dragging the sheet down: on a phone, the
 * grabber and the « Annuler » of the form say it, as in native apps.
 *
 *   <tb-sheet [(ouvert)]="dialogue" titre="Ajouter">…<div class="tb-actions">…</div></tb-sheet>
 */
@Component({
  selector: 'tb-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="tb-scrim" (pointerdown)="surFond($event)" (keydown.escape)="fermer()">
        <section
          #boite
          class="tb-dialog"
          [class.tb-closing]="fermeture()"
          [style.--tb-dialog-w.px]="largeur()"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="idTitre"
          tabindex="-1"
          (animationend)="finAnimation()"
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

  readonly ouvert = model(false);
  readonly titre = input('');
  readonly largeur = input(440);
  readonly sansEntete = input(false, { transform: booleanAttribute });

  protected readonly idTitre = `tb-sheet-titre-${++suivant}`;
  protected readonly visible = signal(false);
  protected readonly fermeture = signal(false);
  private readonly boite = viewChild<ElementRef<HTMLElement>>('boite');
  private focusAvant: HTMLElement | null = null;
  private glisse: { y: number; dy: number; t: number } | null = null;

  constructor() {
    effect(() => {
      if (this.ouvert()) {
        this.focusAvant = this.doc.activeElement as HTMLElement | null;
        this.fermeture.set(false);
        this.visible.set(true);
        this.doc.body.style.overflow = 'hidden';
        queueMicrotask(() => setTimeout(() => this.boite()?.nativeElement.focus({ preventScroll: true })));
      } else if (this.visible()) {
        this.fermeture.set(true);
      }
    });
  }

  fermer(): void {
    this.ouvert.set(false);
  }

  protected surFond(e: PointerEvent): void {
    if (e.target === e.currentTarget) this.fermer();
  }

  protected finAnimation(): void {
    if (!this.fermeture()) return;
    this.visible.set(false);
    this.fermeture.set(false);
    this.doc.body.style.overflow = '';
    this.focusAvant?.focus?.({ preventScroll: true });
  }

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
          this.visible.set(false);
          this.doc.body.style.overflow = '';
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
