import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { locale } from '../../core/i18n';
import { UnitService } from '../../core/unit';
import { AlertRule, AlertRuleRoom } from '../../models/models';
import { AlertStore } from '../../services/alert.store';
import { ShownCount, TbMore } from '../../ui/more';
import { TrPipe } from '../../ui/tr.pipe';

type Sort = 'alert' | 'name' | 'gap';

/**
 * The rooms where an alert rule applies (ADMIN, 26.12), as the server's monitor sees them: those
 * it covers where no nearer rule replaces it. Their temperature against the threshold of the rule,
 * the ones in alert first, by name, or the closest to the threshold first. Opened from a rule of
 * the Alertes section; read again each time it opens.
 */
@Component({
  selector: 'tb-alert-rule-rooms',
  imports: [TrPipe, TbMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-alert-rooms' },
  template: `
    @if (rooms(); as list) {
      <div class="tb-alert-rooms-head">
        <span class="tb-muted">
          {{ list.length > 1 ? list.length + (' salles' | tr) : list.length === 1 ? ('1 salle' | tr) : ('Aucune salle' | tr) }}@if (alerted()) {
            · <span class="tb-alert-rooms-hot">{{ alerted() }} {{ 'en alerte' | tr }}</span>
          }
        </span>
        @if (list.length > 1) {
          <label class="tb-alert-sort-label">
            <span i18n class="tb-muted">Trier</span>
            <select class="tb-select tb-alert-sort" (change)="setSort($any($event.target).value)">
              @for (o of sorts; track o.id) {
                <option [value]="o.id" [selected]="sort() === o.id">{{ o.label }}</option>
              }
            </select>
          </label>
        }
      </div>
      @if (list.length) {
        <ul class="tb-alert-room-list">
          @for (r of sorted().slice(0, shown.count()); track r.id) {
            <li class="tb-alert-room">
              <span class="tb-alert-room-text">
                <strong>{{ r.name ?? ('Salle sans nom' | tr) }}</strong>
                <span class="tb-muted">{{ r.place }}</span>
              </span>
              <span class="tb-alert-room-values">
                @if (r.temperature != null) {
                  <strong>{{ unit.withSymbol(r.temperature) }}</strong>
                } @else {
                  <strong class="tb-muted">—</strong>
                }
                <span class="tb-muted">
                  @if (r.threshold != null) { {{ 'seuil ' | tr }}{{ unit.withSymbol(r.threshold) }} } @else { <ng-container i18n>sans consigne</ng-container> }
                </span>
              </span>
              @if (r.alertId != null) {
                <span i18n class="tb-tag tb-tag-danger"><i class="pi pi-exclamation-circle"></i>En alerte</span>
              } @else if (r.exceeding) {
                <span i18n class="tb-tag tb-tag-warning">Au-dessus</span>
              } @else if (r.threshold == null) {
                <span i18n class="tb-tag">Non surveillée</span>
              } @else if (r.temperature == null) {
                <span i18n class="tb-tag">Pas de mesure</span>
              }
            </li>
          }
        </ul>
        <tb-more [total]="list.length" [shown]="shown.count()" (more)="shown.more()" />
      } @else {
        <p i18n class="tb-muted tb-alert-rooms-note">Une règle plus proche la remplace partout, ou ses éléments ne contiennent aucune salle.</p>
      }
    } @else if (error(); as e) {
      <p class="tb-field-error tb-alert-rooms-note">{{ e }}</p>
    } @else if (alerts.ruleRoomsAvailable() === false) {
      <p i18n class="tb-muted tb-alert-rooms-note">Ce serveur ne sait pas encore lister les salles d'une règle (ThermoBox 26.12.0-alpha.8 ou plus récent).</p>
    } @else {
      <p i18n class="tb-muted tb-alert-rooms-note"><i class="pi pi-spin pi-spinner"></i> Chargement des salles…</p>
    }
  `,
})
export class TbAlertRuleRooms {
  protected readonly alerts = inject(AlertStore);
  protected readonly unit = inject(UnitService);

  readonly rule = input.required<AlertRule>();

  protected readonly sorts: { id: Sort; label: string }[] = [
    { id: 'alert', label: $localize`En alerte d'abord` },
    { id: 'name', label: $localize`Nom` },
    { id: 'gap', label: $localize`Écart au seuil` },
  ];
  protected readonly sort = signal<Sort>('alert');
  protected readonly rooms = signal<AlertRuleRoom[] | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Hundreds of rooms for a rule of the whole site: a part at a time. */
  protected readonly shown = new ShownCount(30);

  protected readonly alerted = computed(() => (this.rooms() ?? []).filter((r) => r.alertId != null).length);

  private readonly collator = new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' });

  protected readonly sorted = computed(() => {
    const list = [...(this.rooms() ?? [])];
    const byName = (a: AlertRuleRoom, b: AlertRuleRoom) => this.collator.compare(a.name ?? '', b.name ?? '') || this.collator.compare(a.place, b.place);
    // Above the threshold first: the highest temperature − threshold; no value last
    const gap = (r: AlertRuleRoom) => (r.temperature != null && r.threshold != null ? r.temperature - r.threshold : Number.NEGATIVE_INFINITY);
    const byGap = (a: AlertRuleRoom, b: AlertRuleRoom) => gap(b) - gap(a) || byName(a, b);
    const rank = (r: AlertRuleRoom) => (r.alertId != null ? 0 : r.exceeding ? 1 : 2);
    switch (this.sort()) {
      case 'name':
        return list.sort(byName);
      case 'gap':
        return list.sort(byGap);
      default:
        return list.sort((a, b) => rank(a) - rank(b) || byGap(a, b));
    }
  });

  constructor() {
    // Read when opened, and again when the rule changes (saved, turned on or off)
    effect(() => {
      const r = this.rule();
      untracked(() => void this.load(r.id));
    });
  }

  protected setSort(s: Sort): void {
    this.sort.set(s);
    this.shown.reset();
  }

  private async load(id: number): Promise<void> {
    this.error.set(null);
    try {
      this.rooms.set(await this.alerts.ruleRooms(id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
