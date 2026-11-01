import { ChangeDetectionStrategy, Component, Directive, ElementRef, booleanAttribute, computed, effect, inject, input, model, signal } from '@angular/core';

import { PlateformeService } from '../core/plateforme';
import { PreferencesService } from '../core/preferences';
import { UniteService, lireNombre } from '../core/unite';

/** On / off switch (p:toggleSwitch), restyled per platform. */
@Component({
  selector: 'tb-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <button
      type="button"
      role="switch"
      class="tb-switch"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label() || null"
      [disabled]="disabled()"
      (click)="basculer()"
    ></button>
  `,
})
export class TbSwitch {
  private readonly plateforme = inject(PlateformeService);
  readonly checked = model(false);
  readonly label = input('');
  readonly disabled = input(false, { transform: booleanAttribute });

  basculer(): void {
    this.checked.update((v) => !v);
    this.plateforme.vibrer();
  }
}

/** Consigne stepper (p:spinner): − 20,5 °C +, in the unit of the Préférences page. */
@Component({
  selector: 'tb-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tb-stepper">
      <button type="button" [class.tb-maintenu]="maintenu() === -1" (pointerdown)="appuyer(-1, $event)" (click)="clic(-1, $event)" aria-label="Moins"><i class="pi pi-minus"></i></button>
      <input
        type="text"
        inputmode="decimal"
        [id]="inputId() || null"
        [value]="texte()"
        (change)="saisir($any($event.target).value)"
        (keydown.arrowup)="pas(1); $event.preventDefault()"
        (keydown.arrowdown)="pas(-1); $event.preventDefault()"
        [attr.aria-label]="'Consigne en ' + unite.symbole()"
      />
      <span class="tb-stepper-unite">{{ unite.symbole() }}</span>
      <button type="button" [class.tb-maintenu]="maintenu() === 1" (pointerdown)="appuyer(1, $event)" (click)="clic(1, $event)" aria-label="Plus"><i class="pi pi-plus"></i></button>
    </span>
  `,
})
export class TbStepper {
  protected readonly unite = inject(UniteService);
  private readonly plateforme = inject(PlateformeService);
  /** In the unit of the Préférences page. */
  readonly valeur = model<number | null>(null);
  readonly inputId = input('');

  protected readonly texte = computed(() => {
    const v = this.valeur();
    return v == null ? '' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  });

  /** − or + held down: it repeats, faster and faster (as the dial of « Maison »). */
  protected readonly maintenu = signal<0 | 1 | -1>(0);
  private repetition?: ReturnType<typeof setTimeout>;

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
        if (this.valeur() === avant) return this.relacher();
        n++;
        suivant([150, 110, 80, 60][Math.min(3, Math.floor(n / 4))]);
      }, delai);
    };
    suivant(380);
  }

  /** Keyboard (Enter, Space): a pointer already stepped on pointerdown. */
  protected clic(sens: 1 | -1, e: MouseEvent): void {
    if (e.detail === 0) this.pas(sens);
  }

  private relacher(): void {
    clearTimeout(this.repetition);
    this.maintenu.set(0);
  }

  protected pas(sens: number): void {
    const step = this.unite.consigneStep();
    const v = this.valeur() ?? (this.unite.fahrenheit() ? 68 : 20);
    this.valeur.set(this.borner(Math.round((v + sens * step) / step) * step));
    this.plateforme.vibrer();
  }

  protected saisir(t: string): void {
    const n = lireNombre(t);
    this.valeur.set(n == null ? null : this.borner(Math.round(n * 10) / 10));
  }

  private borner(v: number): number {
    return Math.min(this.unite.consigneMax(), Math.max(this.unite.consigneMin(), v));
  }
}

/**
 * A value that changed during a refresh pulses once (tbWatch of the JSF interface):
 *   <span [tbWatch]="salle.temperature">…</span>
 */
@Directive({ selector: '[tbWatch]' })
export class TbWatch {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly prefs = inject(PreferencesService);
  readonly tbWatch = input<unknown>();
  private premiere = true;
  private avant: unknown;

  constructor() {
    effect(() => {
      const v = this.tbWatch();
      if (!this.premiere && v !== this.avant && this.prefs.animer()) {
        this.el.nativeElement.animate(
          [
            { transform: 'translateY(6px)', opacity: 0.2, filter: 'blur(3px)' },
            { transform: 'none', opacity: 1, filter: 'none' },
          ],
          { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
      this.premiere = false;
      this.avant = v;
    });
  }
}

/** Password field with its eye (p:password toggleMask). */
@Component({
  selector: 'tb-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tb-password">
      <input
        class="tb-input"
        [type]="visible ? 'text' : 'password'"
        [id]="inputId()"
        [value]="valeur()"
        (input)="valeur.set($any($event.target).value)"
        [attr.autocomplete]="autocomplete()"
        [class.tb-invalid]="invalide()"
        [attr.aria-invalid]="invalide()"
        [required]="requis()"
      />
      <button type="button" (click)="visible = !visible" [attr.aria-label]="visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
        <i class="pi" [class.pi-eye]="!visible" [class.pi-eye-slash]="visible"></i>
      </button>
    </span>
  `,
})
export class TbPassword {
  readonly valeur = model('');
  readonly inputId = input('');
  readonly autocomplete = input('current-password');
  readonly invalide = input(false);
  readonly requis = input(false, { transform: booleanAttribute });
  protected visible = false;
}
