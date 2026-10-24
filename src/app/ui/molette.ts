import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, model, signal, viewChild } from '@angular/core';

import { PlateformeService } from '../core/plateforme';
import { UniteService } from '../core/unite';

/** The arc covers 270°, from the bottom left to the bottom right. */
const DEBUT = -225;
const OUVERTURE = 270;
const R = 120;
const C = 150;
/** − / + held: first repeat after this delay (ms), then faster and faster. */
const ATTENTE = 380;
const CADENCE = [150, 110, 80, 60];

/**
 * « Maison »: the consigne as the dial of a thermostat. The temperature in its centre, the
 * consigne as a knob on the arc, turned with a finger (or the arrows of the keyboard, or − / +,
 * which repeat when held). The arc spans the range people set at home (10-30 °C); the bounds of a
 * consigne still apply.
 *
 * Only the knob turns the dial: a finger that lands on the arc to scroll the page, or a click
 * beside it, changes nothing.
 *
 *   <tb-molette [temperature]="e.temperature" [consigne]="e.consigne?.value" [(valeur)]="nouvelle" [couleur]="c" />
 */
@Component({
  selector: 'tb-molette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-molette" [class.tb-molette-saisie]="saisie()" [style.--m]="couleur()">
      <svg #cadran viewBox="0 0 300 300" aria-hidden="false">
        <path class="tb-molette-piste" [attr.d]="piste()" />
        @if (position() != null) {
          <!-- The filled part: the same path, drawn up to the consigne (it slides, not jumps) -->
          <path class="tb-molette-arc" [attr.d]="piste()" pathLength="270" [style.stroke-dasharray]="angle() + ' 1000'" />
        }
        @if (modifiable() && position() != null) {
          <g class="tb-molette-poignee" [style.transform]="'rotate(' + angle() + 'deg)'">
            <!-- A wider ring than the knob, easier to catch with a finger -->
            <circle class="tb-molette-prise" [attr.cx]="depart[0]" [attr.cy]="depart[1]" r="34" (pointerdown)="saisir($event)" />
            <circle class="tb-molette-bouton" [attr.cx]="depart[0]" [attr.cy]="depart[1]" r="16"
                    role="slider" tabindex="0" aria-label="Consigne"
                    [attr.aria-valuemin]="unite.consigneMin()" [attr.aria-valuemax]="unite.consigneMax()" [attr.aria-valuenow]="valeur()"
                    [attr.aria-valuetext]="texte(valeur()) + ' ' + unite.symbole()"
                    (pointerdown)="saisir($event)"
                    (keydown.arrowup)="pas(1, $event)" (keydown.arrowright)="pas(1, $event)"
                    (keydown.arrowdown)="pas(-1, $event)" (keydown.arrowleft)="pas(-1, $event)" />
          </g>
        }
      </svg>
      <div class="tb-molette-centre">
        <small>Il fait</small>
        <b class="tb-chiffres" [attr.data-vt]="vtId() != null ? 'salle-temp' : null" [attr.data-vt-id]="vtId()">{{ unite.t(temperature()) }}<span>°</span></b>
        <!-- Re-created at each step: the new figure pops in -->
        @for (o of [objectif()]; track o) {
          <em [class.tb-molette-nouvelle]="modifie()">{{ o }}</em>
        }
      </div>
    </div>
    @if (modifiable()) {
      <div class="tb-molette-pas">
        <button type="button" [class.tb-maintenu]="maintenu() === -1" aria-label="Baisser la consigne"
                (pointerdown)="appuyer(-1, $event)" (click)="clic(-1, $event)"><i class="pi pi-minus"></i></button>
        <button type="button" [class.tb-maintenu]="maintenu() === 1" aria-label="Monter la consigne"
                (pointerdown)="appuyer(1, $event)" (click)="clic(1, $event)"><i class="pi pi-plus"></i></button>
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
  /** The knob is held: it follows the finger without easing. */
  protected readonly saisie = signal(false);
  /** − or + held down (repeating). */
  protected readonly maintenu = signal<0 | 1 | -1>(0);
  private repetition?: ReturnType<typeof setTimeout>;

  /** Range of the arc, in the unit shown. */
  protected readonly bas = computed(() => (this.unite.fahrenheit() ? 50 : 10));
  protected readonly haut = computed(() => (this.unite.fahrenheit() ? 86 : 30));

  /** Value at the knob (the one being set, else the current consigne), in the unit shown. */
  protected readonly position = computed(() => {
    const v = this.valeur() ?? (this.consigne() != null ? this.unite.depuisCelsius(this.consigne()!) : null);
    return v == null ? null : Math.min(this.haut(), Math.max(this.bas(), v));
  });
  /** Degrees along the arc, 0-270. */
  protected readonly angle = computed(() => {
    const p = this.position();
    return p == null ? 0 : ((p - this.bas()) / (this.haut() - this.bas())) * OUVERTURE;
  });
  protected readonly modifie = computed(() => {
    const c = this.consigne();
    const v = this.valeur();
    return v != null && (c == null || Math.abs(this.unite.saisieVersCelsius(v) - c) >= 0.05);
  });
  protected readonly objectif = computed(() => {
    if (this.valeur() != null && this.modifie()) return `Objectif ${this.texte(this.valeur())}°`;
    if (this.consigne() != null) return `Objectif ${this.unite.t(this.consigne())}°`;
    return "Pas d'objectif";
  });

  /** The whole track, and the start of the arc (where the knob sits before it is rotated). */
  protected readonly piste = computed(() => {
    const [x1, y1] = point(0);
    const [x2, y2] = point(OUVERTURE);
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 1 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  });
  protected readonly depart = point(0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.relacher());
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

  // ---------------------------------------------------------------- − / + held

  protected appuyer(sens: 1 | -1, e: PointerEvent): void {
    if (e.button !== 0) return;
    this.relacher();
    this.pas(sens);
    this.maintenu.set(sens);
    const bouton = e.currentTarget as HTMLElement;
    const fin = () => {
      this.relacher();
      bouton.removeEventListener('pointerup', fin);
      bouton.removeEventListener('pointerleave', fin);
      bouton.removeEventListener('pointercancel', fin);
    };
    bouton.addEventListener('pointerup', fin);
    bouton.addEventListener('pointerleave', fin);
    bouton.addEventListener('pointercancel', fin);
    let n = 0;
    const suivant = (delai: number) => {
      this.repetition = setTimeout(() => {
        const avant = this.valeur();
        this.pas(sens);
        // At a bound: nothing more to do
        if (this.valeur() === avant) return this.relacher();
        n++;
        suivant(CADENCE[Math.min(CADENCE.length - 1, Math.floor(n / 4))]);
      }, delai);
    };
    suivant(ATTENTE);
  }

  /** Clicks from the keyboard (Enter, Space); a pointer already stepped on pointerdown. */
  protected clic(sens: 1 | -1, e: MouseEvent): void {
    if (e.detail === 0) this.pas(sens);
  }

  private relacher(): void {
    clearTimeout(this.repetition);
    this.maintenu.set(0);
  }

  // ---------------------------------------------------------------- the knob

  /** Turned with the finger (or the mouse) along the arc, from the knob only. */
  protected saisir(e: PointerEvent): void {
    const svg = this.cadran()?.nativeElement;
    if (!svg || !this.modifiable() || e.button !== 0) return;
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
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    this.saisie.set(true);
    const bouger = (ev: PointerEvent) => lire(ev);
    const fin = () => {
      this.saisie.set(false);
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

/** Point of the arc [a] degrees from its start. */
function point(a: number): [number, number] {
  const r = ((DEBUT + a) * Math.PI) / 180;
  return [C + R * Math.cos(r), C + R * Math.sin(r)];
}
