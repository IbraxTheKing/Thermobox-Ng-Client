import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { ConfirmService, ToastService } from '../../core/messages';
import { UnitService, parseNumber } from '../../core/unit';
import { AlertRule, AlertRuleRequest } from '../../models/models';
import { AlertStore } from '../../services/alert.store';
import { TreeStore } from '../../services/tree.store';
import { TbAccessTree } from '../../ui/access-tree';
import { TbMultipleChoice } from '../../ui/multiple-choice';
import { TbSheet } from '../../ui/sheet';
import { TrPipe } from '../../ui/tr.pipe';
import { duration, explain } from './alert-text';

/** Reminders offered (seconds); a rule saved with another value keeps it in the list. */
const REMINDERS = [0, 900, 1800, 3600, 2 * 3600, 6 * 3600, 12 * 3600, 86400];
/** Durations of the server (AlertService): 0 to 6 h. */
const MAX_MINUTES = 6 * 60;

/**
 * A rule of the temperature alerts (ADMIN, 26.12): how far above the setpoint and for how long
 * before an alert, when it ends, the reminders, where (the whole installation or some buildings,
 * floors, rooms with what they contain) and which channels are warned.
 *
 *   <tb-alert-rule-sheet />   …   sheet.create() / sheet.edit(rule) / sheet.remove(rule)
 */
@Component({
  selector: 'tb-alert-rule-sheet',
  imports: [TrPipe, TbSheet, TbAccessTree, TbMultipleChoice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" [title]="creation() ? ('Nouvelle règle' | tr) : ('Modifier la règle' | tr)" [width]="560">
      <form (submit)="save($event)" novalidate>
        <div class="tb-field">
          <label i18n class="tb-label" for="tb-ar-name">Nom</label>
          <input id="tb-ar-name" class="tb-input" autocomplete="off" maxlength="100" i18n-placeholder placeholder="Salles serveurs, Tout le site…"
                 [value]="name()" (input)="name.set($any($event.target).value)" [class.tb-invalid]="submitted() && nameError()" />
          @if (submitted() && nameError(); as e) {
            <span class="tb-field-error">{{ e }}</span>
          }
        </div>

        <div class="tb-field">
          <label i18n class="tb-label" for="tb-ar-tolerance">Tolérance au-dessus de la consigne</label>
          <span class="tb-alert-unit">
            <input id="tb-ar-tolerance" class="tb-input" type="number" inputmode="decimal" min="0" step="0.5"
                   [value]="tolerance() ?? ''" (input)="tolerance.set(parseNumber($any($event.target).value))" [class.tb-invalid]="submitted() && toleranceError()" />
            <span class="tb-muted">{{ unit.symbol() }}</span>
          </span>
          @if (submitted() && toleranceError(); as e) {
            <span class="tb-field-error">{{ e }}</span>
          } @else {
            <span i18n class="tb-field-hint">Une salle est en dépassement quand un de ses boîtiers mesure plus que sa consigne + cet écart.</span>
          }
        </div>

        <div class="tb-field-row">
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ar-min">Alerter après</label>
            <span class="tb-alert-unit">
              <input id="tb-ar-min" class="tb-input" type="number" inputmode="numeric" min="0" [max]="maxMinutes"
                     [value]="minMinutes() ?? ''" (input)="minMinutes.set(parseNumber($any($event.target).value))" [class.tb-invalid]="submitted() && minError()" />
              <span i18n class="tb-muted">min</span>
            </span>
            @if (submitted() && minError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            } @else {
              <span i18n class="tb-field-hint">au-dessus sans interruption</span>
            }
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ar-clear">Fin de l'alerte après</label>
            <span class="tb-alert-unit">
              <input id="tb-ar-clear" class="tb-input" type="number" inputmode="numeric" min="0" [max]="maxMinutes"
                     [value]="clearMinutes() ?? ''" (input)="clearMinutes.set(parseNumber($any($event.target).value))" [class.tb-invalid]="submitted() && clearError()" />
              <span i18n class="tb-muted">min</span>
            </span>
            @if (submitted() && clearError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            } @else {
              <span i18n class="tb-field-hint">tous les boîtiers revenus sous le seuil</span>
            }
          </div>
        </div>

        <div class="tb-field">
          <label i18n class="tb-label" for="tb-ar-reminder">Rappel tant que ça dure</label>
          <select id="tb-ar-reminder" class="tb-select" (change)="reminder.set(+$any($event.target).value)">
            @for (r of reminders(); track r) {
              <option [value]="r" [selected]="reminder() === r">{{ r ? (('Toutes les ' | tr) + duration(r)) : ('Jamais' | tr) }}</option>
            }
          </select>
        </div>

        <div class="tb-field">
          <label class="tb-choice">
            <input type="checkbox" [checked]="notifyResolution()" (change)="notifyResolution.set($any($event.target).checked)" />
            <span i18n>Prévenir du retour à la normale</span>
          </label>
        </div>

        <div class="tb-field">
          <span i18n class="tb-label">Où</span>
          <div class="tb-access-mode" role="radiogroup" i18n-aria-label aria-label="Où">
            <label i18n class="tb-choice"><input type="radio" name="tb-ar-where" [checked]="global()" (change)="global.set(true)" />Toute l'installation</label>
            <label i18n class="tb-choice"><input type="radio" name="tb-ar-where" [checked]="!global()" (change)="global.set(false)" />Seulement les éléments cochés (et ce qu'ils contiennent)</label>
          </div>
          @if (!global()) {
            @if (tree.loading() && !tree.nodes().length) {
              <p i18n class="tb-muted"><i class="pi pi-spin pi-spinner"></i> Chargement…</p>
            } @else {
              <tb-tree-access [nodes]="tree.nodes()" [(checked)]="checked" />
            }
            @if (submitted() && scopeError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }
          }
          <span i18n class="tb-field-hint">Une règle sur une salle passe avant celle de son étage, de son bâtiment, puis les règles globales.</span>
        </div>

        <div class="tb-field">
          <span i18n class="tb-label">Canaux à prévenir</span>
          @if (channelOptions().length) {
            <tb-choice-multiple [options]="channelOptions()" [(value)]="channels" i18n-placeholder placeholder="Rechercher un canal…" i18n-empty empty="Aucun canal" />
          } @else {
            <p i18n class="tb-muted">Aucun canal pour le moment : ajoute un e-mail ou un webhook dans « Canaux ».</p>
          }
          @if (!channels().size && channelOptions().length) {
            <span i18n class="tb-field-hint">Sans canal, les alertes sont seulement gardées dans l'historique.</span>
          }
        </div>

        <div class="tb-actions">
          @if (!creation()) {
            <button i18n type="button" class="tb-btn tb-flat tb-btn-danger tb-actions-start" [disabled]="saving()" (click)="removeShown()"><i class="pi pi-trash"></i>Supprimer</button>
          }
          <button i18n type="button" class="tb-btn tb-flat" (click)="shown.set(false)">Annuler</button>
          <button i18n type="submit" class="tb-btn" [disabled]="saving()"><i class="pi pi-check"></i>Enregistrer</button>
        </div>
      </form>
    </tb-sheet>
  `,
})
export class TbAlertRuleSheet {
  private readonly alerts = inject(AlertStore);
  protected readonly tree = inject(TreeStore);
  protected readonly unit = inject(UnitService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly accessTree = viewChild(TbAccessTree);

  protected readonly parseNumber = parseNumber;
  protected readonly duration = duration;
  protected readonly maxMinutes = MAX_MINUTES;

  protected readonly shown = signal(false);
  private readonly rule = signal<AlertRule | null>(null);
  protected readonly creation = computed(() => this.rule() == null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly name = signal('');
  /** In the unit of the Préférences page (a difference: 1 °C is 1,8 °F). */
  protected readonly tolerance = signal<number | null>(1);
  protected readonly minMinutes = signal<number | null>(10);
  protected readonly clearMinutes = signal<number | null>(10);
  protected readonly reminder = signal(0);
  protected readonly notifyResolution = signal(true);
  protected readonly global = signal(true);
  protected readonly checked = signal<Set<number>>(new Set());
  protected readonly channels = signal<Set<number>>(new Set());

  protected readonly reminders = computed(() => {
    const r = this.reminder();
    return REMINDERS.includes(r) ? REMINDERS : [...REMINDERS, r].sort((a, b) => a - b);
  });
  protected readonly channelOptions = computed(() =>
    this.alerts.channels().map((c) => ({ id: c.id, label: c.name, detail: (c.kind === 'EMAIL' ? $localize`e-mail` : $localize`webhook`) + (c.enabled ? '' : $localize` · coupé`) })),
  );

  protected readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return $localize`Nom obligatoire`;
    return n.length > 100 ? $localize`100 caractères au plus` : null;
  });
  private toleranceCelsius(): number | null {
    const t = this.tolerance();
    return t == null ? null : Math.round((this.unit.fahrenheit() ? (t * 5) / 9 : t) * 10) / 10;
  }
  protected readonly toleranceError = computed(() => {
    const c = this.toleranceCelsius();
    return c == null || c < 0 || c > 20 ? $localize`De 0 à ${this.unit.fahrenheit() ? 36 : 20} ${this.unit.symbol()}` : null;
  });
  private minutesError(v: number | null): string | null {
    return v == null || v < 0 || v > MAX_MINUTES || !Number.isInteger(v) ? $localize`De 0 à ${MAX_MINUTES} min (6 h)` : null;
  }
  protected readonly minError = computed(() => this.minutesError(this.minMinutes()));
  protected readonly clearError = computed(() => this.minutesError(this.clearMinutes()));
  protected readonly scopeError = computed(() => (!this.global() && !this.checked().size ? $localize`Coche au moins un bâtiment, un étage ou une salle` : null));

  create(): void {
    this.fill(null);
  }

  edit(r: AlertRule): void {
    this.fill(r);
  }

  private fill(r: AlertRule | null): void {
    if (!this.tree.tree()) void this.tree.load().catch(() => undefined);
    const f = this.unit.fahrenheit() ? 9 / 5 : 1;
    this.rule.set(r);
    this.name.set(r?.name ?? '');
    this.tolerance.set(Math.round((r?.tolerance ?? 1) * f * 10) / 10);
    this.minMinutes.set(Math.round((r?.minDurationSeconds ?? 600) / 60));
    this.clearMinutes.set(Math.round((r?.clearAfterSeconds ?? 600) / 60));
    this.reminder.set(r?.reminderSeconds ?? 0);
    this.notifyResolution.set(r?.notifyResolution ?? true);
    this.global.set(r?.global ?? true);
    this.checked.set(TbAccessTree.check(this.tree.nodes(), (r?.scope ?? []).map((e) => e.id)));
    this.channels.set(new Set(r ? r.channels.map((c) => c.id) : this.alerts.channels().filter((c) => c.enabled).map((c) => c.id)));
    this.submitted.set(false);
    this.shown.set(true);
    // The tree came after: the elements of the rule ticked once it is there
    if (r && !r.global && !this.tree.nodes().length) {
      void this.tree.load().then(() => this.rule() === r && this.checked.set(TbAccessTree.check(this.tree.nodes(), r.scope.map((e) => e.id)))).catch(() => undefined);
    }
  }

  private request(): AlertRuleRequest {
    const kept = this.accessTree()?.kept() ?? [...this.checked()];
    return {
      name: this.name().trim(),
      enabled: this.rule()?.enabled ?? true,
      tolerance: this.toleranceCelsius()!,
      minDurationSeconds: this.minMinutes()! * 60,
      clearAfterSeconds: this.clearMinutes()! * 60,
      reminderSeconds: this.reminder(),
      notifyResolution: this.notifyResolution(),
      global: this.global(),
      scope: this.global() ? [] : kept,
      channels: [...this.channels()],
    };
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.submitted.set(true);
    if (this.nameError() || this.toleranceError() || this.minError() || this.clearError() || this.scopeError()) return;
    const r = this.rule();
    this.saving.set(true);
    try {
      const saved = r ? await this.alerts.updateRule(r.id, this.request()) : await this.alerts.createRule(this.request());
      this.toasts.info(r ? $localize`Règle « ${saved.name} » modifiée` : $localize`Règle « ${saved.name} » créée`);
      this.shown.set(false);
    } catch (err) {
      this.toasts.error($localize`Règle non enregistrée`, explain(errorMessage(err)));
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeShown(): Promise<void> {
    const r = this.rule();
    if (r && (await this.remove(r))) this.shown.set(false);
  }

  /** Deletes [r] after a confirmation; true when done. */
  async remove(r: AlertRule): Promise<boolean> {
    if (!(await this.confirm.ask($localize`Supprimer`, $localize`Supprimer la règle « ${r.name} » ? Ses alertes en cours sont annulées.`, { confirm: $localize`Supprimer` }))) return false;
    try {
      await this.alerts.deleteRule(r.id);
      this.toasts.info($localize`Règle « ${r.name} » supprimée`);
      return true;
    } catch (e) {
      this.toasts.error($localize`Suppression impossible`, errorMessage(e));
      return false;
    }
  }
}
