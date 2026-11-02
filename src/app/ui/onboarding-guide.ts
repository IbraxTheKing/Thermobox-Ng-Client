import { ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { AuthService } from '../core/auth';
import { OnboardingService } from '../core/onboarding';
import { PlatformService } from '../core/platform';
import { DESKTOP_OS } from '../core/tauri';
import { TrPipe } from './tr.pipe';

interface Step {
  icon: string;
  title: string;
  text: string;
  /** Link of the side bar (or of the bar at the bottom) the step speaks of: ringed while shown. */
  target?: string;
}

/**
 * The guide of a first visit, for the role of the account: a reader learns to read the rooms, a
 * manager also to change their setpoints and see their boxes, an admin also to manage the
 * accounts (import included) and the server. A card in the middle of the screen, one step at a
 * time, the place of the app it speaks of ringed in the navigation; « Passer » at every step,
 * Escape too. Replayed from Préférences › Divers.
 *
 * - Phones: the card sits at the bottom, above the bar of the app (under the thumb, the ringed
 *   tab above it in view), in the look of the platform (Material 3, iOS glass).
 * - Windows: a TeachingTip of WinUI 3, the control of Windows for this: pointing at the item of
 *   the NavigationView it speaks of, no dimmed page, its close button in the corner.
 */
@Component({
  selector: 'tb-onboarding-guide',
  imports: [TrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (guide.open()) {
      <div class="tb-guide-scrim"></div>
      @if (ring(); as r) {
        <div class="tb-guide-ring" aria-hidden="true" [style.left.px]="r.left" [style.top.px]="r.top" [style.width.px]="r.width" [style.height.px]="r.height"></div>
      }
      <section class="tb-guide" role="dialog" aria-modal="true" aria-labelledby="tb-guide-title" aria-describedby="tb-guide-text" (keydown)="key($event)" #card tabindex="-1"
               [class.tb-guide-docked]="docked()" [class.tb-guide-tip]="!!tip()" [class.tb-guide-tip-below]="tip()?.below"
               [style.left.px]="tip()?.left" [style.top.px]="tip()?.top" [style.--tb-tail.px]="tip()?.tail">
        @let s = step();
        @if (winui) {
          <button type="button" class="tb-guide-close" i18n-aria-label aria-label="Fermer le guide" i18n-title title="Fermer le guide" (click)="skip()">&#xE8BB;</button>
        }
        <div class="tb-guide-art" aria-hidden="true">
          <i class="pi {{ s.icon }}"></i>
        </div>
        <p class="tb-guide-role">{{ roleLine() }}</p>
        <h2 id="tb-guide-title">{{ s.title }}</h2>
        <p id="tb-guide-text" class="tb-guide-text">{{ s.text }}</p>
        <div class="tb-guide-dots" role="tablist" i18n-aria-label aria-label="Étapes du guide">
          @for (x of steps(); track $index; let i = $index) {
            <button type="button" role="tab" [class.tb-guide-dot-on]="i === index()" [attr.aria-selected]="i === index()" [attr.aria-label]="('Étape ' | tr) + (i + 1)" (click)="go(i)"></button>
          }
        </div>
        <div class="tb-guide-actions">
          @if (!last()) {
            <button i18n type="button" class="tb-btn tb-flat tb-guide-skip" (click)="skip()">Passer le guide</button>
          }
          @if (index() > 0) {
            <button i18n type="button" class="tb-btn tb-flat" (click)="go(index() - 1)"><i class="pi pi-arrow-left"></i>Précédent</button>
          }
          <button type="button" class="tb-btn tb-guide-next" (click)="next()" #primary>
            {{ last() ? ('C\\'est parti' | tr) : ('Suivant' | tr) }}<i class="pi" [class.pi-arrow-right]="!last()" [class.pi-check]="last()"></i>
          </button>
        </div>
      </section>
    }
  `,
})
export class TbOnboardingGuide {
  protected readonly guide = inject(OnboardingService);
  private readonly auth = inject(AuthService);
  private readonly doc = inject(DOCUMENT);
  private readonly platform = inject(PlatformService);
  /** Windows: a TeachingTip of WinUI 3. */
  protected readonly winui = DESKTOP_OS === 'windows';
  /** Phones: at the bottom of the screen, above the bar of the app. */
  protected readonly docked = computed(() => !this.winui && this.platform.bottomBar());
  /** Windows: where the tip goes, beside the item it points at (null: in the middle). */
  protected readonly tip = signal<{ left: number; top: number; tail: number; below: boolean } | null>(null);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly primary = viewChild<ElementRef<HTMLElement>>('primary');

  protected readonly index = signal(0);

  protected readonly steps = computed<Step[]>(() => {
    const role = this.auth.role();
    const manager = role === 'MANAGER' || role === 'ADMIN';
    const admin = role === 'ADMIN';
    const name = this.auth.user()?.firstName || this.auth.user()?.username || '';
    const steps: Step[] = [
      {
        icon: 'pi-sun',
        title: $localize`Bienvenue, ${name}`,
        text: $localize`ThermoBox montre la température de chaque salle, en direct, et ce qu'elle devrait être. Voici l'essentiel en quelques étapes : tu peux passer ce guide à tout moment.`,
      },
      {
        icon: 'pi-th-large',
        title: $localize`L'aperçu`,
        text: $localize`Une carte par salle, de la couleur de son état : à la bonne température, en chauffe, trop chaude. Touche une carte pour ouvrir la salle, son étoile pour la mettre dans tes favoris, en haut de l'aperçu.`,
        target: '/app/overview',
      },
      {
        icon: 'pi-home',
        title: $localize`Une salle`,
        text: manager
          ? $localize`La température de la salle, sa consigne et sa courbe des dernières heures. Tu peux changer sa consigne : celle d'un bâtiment ou d'un étage vaut pour tout ce qu'il contient.`
          : $localize`La température de la salle, sa consigne (la température voulue) et sa courbe des dernières heures. Les consignes sont réglées par les gestionnaires.`,
      },
      {
        icon: 'pi-chart-line',
        title: $localize`L'historique`,
        text: $localize`Les courbes de plusieurs salles sur la période de ton choix, pour comparer ou retrouver ce qui s'est passé.`,
        target: '/app/measurements',
      },
      {
        icon: 'pi-building',
        title: $localize`Bâtiments et salles`,
        text: $localize`Tous les bâtiments, étages et salles que tu peux voir, rangés comme ils sont sur place.`,
        target: '/app/rooms',
      },
    ];
    if (manager) {
      steps.push({
        icon: 'pi-sliders-h',
        title: $localize`Gérer`,
        text: admin
          ? $localize`Les salles, étages et bâtiments : les créer, les ranger, changer les consignes de plusieurs salles à la fois, voir leurs boîtiers de mesure.`
          : $localize`Les consignes de plusieurs salles à la fois, et les boîtiers de mesure de chaque salle, avec leur dernière mesure.`,
        target: '/app/management',
      });
    }
    if (admin) {
      steps.push(
        {
          icon: 'pi-users',
          title: $localize`Les comptes`,
          text: $localize`Dans Gérer › Utilisateurs et groupes : crée des comptes un par un, ou importe-les d'un fichier Excel ou CSV (chacun reçoit un mot de passe provisoire à changer). Donne-leur des accès par bâtiment, étage ou salle, ou par groupes.`,
          target: '/app/management',
        },
        {
          icon: 'pi-server',
          title: $localize`Le serveur`,
          text: $localize`Les mises à jour de ThermoBox, le logo et les limites de température de l'installation.`,
          target: '/app/server',
        },
      );
    }
    steps.push(
      {
        icon: 'pi-bell',
        title: $localize`Tes préférences`,
        text: $localize`Thème, couleurs, unité, langue, et les notifications quand une salle s'écarte de sa consigne.`,
        target: '/app/preferences',
      },
      {
        icon: 'pi-check-circle',
        title: $localize`C'est tout !`,
        text: $localize`Tu peux revoir ce guide quand tu veux dans Préférences › Divers.`,
      },
    );
    return steps;
  });

  protected readonly step = computed(() => this.steps()[Math.min(this.index(), this.steps().length - 1)]);
  protected readonly last = computed(() => this.index() >= this.steps().length - 1);
  protected readonly roleLine = computed(
    () =>
      ({
        ADMIN: $localize`Compte administrateur`,
        MANAGER: $localize`Compte gestionnaire`,
        VIEWER: $localize`Compte lecteur`,
      })[this.auth.role() ?? 'VIEWER'],
  );

  /** Where the link of the step is on the screen (none: not in the navigation shown). */
  protected readonly ring = signal<{ left: number; top: number; width: number; height: number } | null>(null);

  constructor() {
    effect(() => {
      if (!this.guide.open()) return;
      this.step();
      untracked(() => requestAnimationFrame(() => (this.place(), requestAnimationFrame(() => this.place()))));
    });
    effect(() => {
      if (this.guide.open()) untracked(() => this.index.set(0));
    });
    // The primary button takes the focus, as a dialog's would
    effect(() => {
      const b = this.primary();
      if (b) requestAnimationFrame(() => b.nativeElement.focus({ preventScroll: true }));
    });
    addEventListener('resize', () => this.guide.open() && this.place());
  }

  private place(): void {
    const target = this.step().target;
    const el = target
      ? [...this.doc.querySelectorAll<HTMLElement>(`.tb-rail a[href="${target}"], .tb-rail a[href^="${target}?"], .tb-rail a[href="${target}/"]`)].find((e) => e.offsetParent !== null)
      : null;
    if (!el) {
      this.ring.set(null);
      this.tip.set(null);
      return;
    }
    const r = el.getBoundingClientRect();
    this.ring.set({ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 });
    if (!this.winui) return;
    // TeachingTip: to the right of the item of the pane, its tail on the middle of the item
    const card = this.card()?.nativeElement;
    const h = card?.offsetHeight ?? 260;
    const w = card?.offsetWidth ?? 360;
    if (r.right + 16 + w <= innerWidth - 8) {
      const top = Math.min(Math.max(r.top + r.height / 2 - h / 2, 40), innerHeight - h - 8);
      this.tip.set({ left: r.right + 14, top, tail: r.top + r.height / 2 - top, below: false });
    } else {
      // Pane folded over a narrow window: under the item
      const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), innerWidth - w - 8);
      this.tip.set({ left, top: r.bottom + 14, tail: r.left + r.width / 2 - left, below: true });
    }
  }

  protected go(i: number): void {
    this.index.set(Math.max(0, Math.min(i, this.steps().length - 1)));
    this.primary()?.nativeElement.focus({ preventScroll: true });
  }

  protected next(): void {
    if (this.last()) this.guide.done();
    else this.go(this.index() + 1);
  }

  protected skip(): void {
    this.guide.done();
  }

  protected key(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.skip();
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.go(this.index() - 1);
    else if (e.key === 'Tab') {
      // The focus stays in the card
      const focusable = [...(this.card()?.nativeElement.querySelectorAll<HTMLElement>('button') ?? [])];
      const first = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (e.shiftKey && this.doc.activeElement === first) (e.preventDefault(), lastEl?.focus());
      else if (!e.shiftKey && this.doc.activeElement === lastEl) (e.preventDefault(), first?.focus());
      return;
    } else return;
    e.preventDefault();
  }
}
