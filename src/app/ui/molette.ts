import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, viewChild } from '@angular/core';

import { PlateformeService } from '../core/plateforme';
import { UniteService } from '../core/unite';

/** The arc covers 270°, from the bottom left to the bottom right. */
const DEBUT = -225;
const OUVERTURE = 270;
const R = 120;
const C = 150;

/**
 * « Maison »: the consigne as the dial of a thermostat. The temperature in its centre, the
 * consigne as a knob on the arc, turned with a finger (or the arrows of the keyboard, or − / +).
 * The arc spans the range people set at home (10-30 °C); the bounds of a consigne still apply.
 *
 *   <tb-molette [temperature]="e.temperature" [consigne]="e.consigne?.value" [(valeur)]="nouvelle" [couleur]="c" />
 */
@Component({
  selector: 'tb-molette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-molette" [style.--m]="couleur()">
      <svg #cadran viewBox="0 0 300 300" (pointerdown)="saisir($event)" [class.tb-molette-mobile]="modifiable()">
        <path class="tb-molette-piste" [attr.d]="arc(bas(), haut())" />
        @if (position() != null) {
          <path class="tb-molette-arc" [attr.d]="arc(bas(), position()!)" />
        }
        @if (modifiable() && position() != null) {
          <circle class="tb-molette-bouton" [attr.cx]="point(position()!)[0]" [attr.cy]="point(position()!)[1]" r="16"
                  role="slider" tabindex="0" aria-label="Consigne"
                  [attr.aria-valuemin]="unite.consigneMin()" [attr.aria-valuemax]="unite.consigneMax()" [attr.aria-valuenow]="valeur()"
                  [attr.aria-valuetext]="texte(valeur()) + ' ' + unite.symbole()"
                  (keydown.arrowup)="pas(1, $event)" (keydown.arrowright)="pas(1, $event)"
                  (keydown.arrowdown)="pas(-1, $event)" (keydown.arrowleft)="pas(-1, $event)" />
        }
      </svg>
      <div class="tb-molette-centre">
        <small>Il fait</small>
        <b class="tb-chiffres" [attr.data-vt]="vtId() != null ? 'salle-temp' : null" [attr.data-vt-id]="vtId()">{{ unite.t(temperature()) }}<span>°</span></b>
        @if (valeur() != null && modifie()) {
          <em class="tb-molette-nouvelle">Objectif {{ texte(valeur()) }}°</em>
        } @else if (consigne() != null) {
          <em>Objectif {{ unite.t(consigne()) }}°</em>
        } @else {
          <em>Pas d'objectif</em>
        }
      </div>
    </div>
    @if (modifiable()) {
      <div class="tb-molette-pas">
        <button type="button" (click)="pas(-1)" aria-label="Baisser la consigne"><i class="pi pi-minus"></i></button>
        <button type="button" (click)="pas(1)" aria-label="Monter la consigne"><i class="pi pi-plus"></i></button>
      </div>
    }
  `,
})
export class TbMolette {
  protected readonly unite = inject(UniteService);
  private readonly plateforme = inject(PlateformeService);

  /** Celsius. */
  readonly temperature = input<number | null | undefined>(null);
  /** Current consigne, Celsius. */
  readonly consigne = input<number | null | undefined>(null);
  /** The consigne being set, in the unit of the Préférences page (as tb-stepper). */
  readonly valeur = model<number | null>(null);
  readonly modifiable = input(false);
  readonly couleur = input('var(--md-primary)');
  /** The page of a salle: its temperature morphs from the tile of the dashboard. */
  readonly vtId = input<number | null>(null);

  private readonly cadran = viewChild<ElementRef<SVGSVGElement>>('cadran');

  /** Range of the arc, in the unit shown. */
  protected readonly bas = computed(() => (this.unite.fahrenheit() ? 50 : 10));
  protected readonly haut = computed(() => (this.unite.fahrenheit() ? 86 : 30));

  /** Value at the knob (the one being set, else the current consigne), in the unit shown. */
  protected readonly position = computed(() => {
    const v = this.valeur() ?? (this.consigne() != null ? this.unite.depuisCelsius(this.consigne()!) : null);
    return v == null ? null : Math.min(this.haut(), Math.max(this.bas(), v));
  });
  protected readonly modifie = computed(() => {
    const c = this.consigne();
    const v = this.valeur();
    return v != null && (c == null || Math.abs(this.unite.saisieVersCelsius(v) - c) >= 0.05);
  });

  protected point(v: number): [number, number] {
    const a = ((DEBUT + ((v - this.bas()) / (this.haut() - this.bas())) * OUVERTURE) * Math.PI) / 180;
    return [C + R * Math.cos(a), C + R * Math.sin(a)];
  }

  protected arc(de: number, a: number): string {
    const [x1, y1] = this.point(de);
    const [x2, y2] = this.point(a);
    const grand = ((a - de) / (this.haut() - this.bas())) * OUVERTURE > 180 ? 1 : 0;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${grand} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }

  protected texte(v: number | null): string {
    return v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected pas(sens: number, e?: Event): void {
    e?.preventDefault();
    const step = this.unite.consigneStep();
    const v = this.valeur() ?? this.position() ?? (this.unite.fahrenheit() ? 68 : 20);
    this.poser(Math.round((v + sens * step) / step) * step);
  }

  /** Turned with the finger (or the mouse) along the arc. */
  protected saisir(e: PointerEvent): void {
    const svg = this.cadran()?.nativeElement;
    if (!svg || !this.modifiable()) return;
    const lire = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 300 - C;
      const y = ((ev.clientY - r.top) / r.height) * 300 - C;
      // Angle from the start of the arc, clockwise
      let a = (Math.atan2(y, x) * 180) / Math.PI - DEBUT;
      a = ((a % 360) + 360) % 360;
      if (a > OUVERTURE) a = a > OUVERTURE + (360 - OUVERTURE) / 2 ? 0 : OUVERTURE;
      const step = this.unite.consigneStep();
      this.poser(Math.round((this.bas() + (a / OUVERTURE) * (this.haut() - this.bas())) / step) * step);
    };
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    lire(e);
    const bouger = (ev: PointerEvent) => lire(ev);
    const fin = () => {
      svg.removeEventListener('pointermove', bouger);
      svg.removeEventListener('pointerup', fin);
      svg.removeEventListener('pointercancel', fin);
    };
    svg.addEventListener('pointermove', bouger);
    svg.addEventListener('pointerup', fin);
    svg.addEventListener('pointercancel', fin);
  }

  private poser(v: number): void {
    const borne = Math.min(this.unite.consigneMax(), Math.max(this.unite.consigneMin(), v));
    if (borne !== this.valeur()) this.plateforme.vibrer();
    this.valeur.set(borne);
  }
}
