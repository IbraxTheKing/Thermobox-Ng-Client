import { ChangeDetectionStrategy, Component, OnDestroy, inject, signal, viewChild } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { clockTime, ddmmAtHHmm, parseDate } from '../../core/dates';
import { ToastService } from '../../core/messages';
import { UnitService } from '../../core/unit';
import { AlertChannel, AlertEvent, AlertRule } from '../../models/models';
import { AlertStore } from '../../services/alert.store';
import { TbSwitch } from '../../ui/controls';
import { TrPipe } from '../../ui/tr.pipe';
import { TbAlertChannelSheet } from './alert-channel-sheet';
import { TbAlertRuleSheet } from './alert-rule-sheet';
import { duration, explain } from './alert-text';

/**
 * Temperature alerts (ADMIN, 26.12), in the settings of the Serveur page: the server watches the
 * rooms by itself and warns by email or webhook when one stays above its setpoint. The state of
 * that watch and the alerts in progress, the channels (where to send), the rules (when, and whom).
 * A server without alerts shows nothing of it.
 */
@Component({
  selector: 'tb-alert-settings',
  imports: [TrPipe, TbSwitch, TbAlertChannelSheet, TbAlertRuleSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (alerts.available() !== false) {
      @let status = alerts.status();
      <!-- The watch, the alerts in progress -->
      <section class="tb-panel tb-pref-group tb-pref-admin tb-alerts" aria-labelledby="tb-alerts-title">
        <h2 i18n class="tb-pref-heading" id="tb-alerts-title">Alertes de température</h2>
        <div class="tb-prefs">
          <div class="tb-pref tb-alert-monitor">
            <span class="tb-section-icon"><i class="pi" [class.pi-bell]="status?.enabled !== false" [class.pi-bell-slash]="status?.enabled === false"></i></span>
            <div class="tb-pref-text">
              <strong i18n>Surveillance des salles</strong>
              <span class="tb-muted">
                @if (!status) {
                  @if (alerts.error(); as e) { {{ e }} } @else { <ng-container i18n>Chargement…</ng-container> }
                } @else if (!status.enabled) {
                  <ng-container i18n>Désactivée sur ce serveur (THERMOBOX_ALERTS=false) : aucune salle n'est surveillée par lui.</ng-container>
                } @else {
                  {{ monitorText() }}
                }
              </span>
              @if (status?.lastError; as e) {
                <span class="tb-field-error">{{ e }}</span>
              }
            </div>
            @if (status) {
              @if (!status.enabled) {
                <span i18n class="tb-tag">Désactivée</span>
              } @else if (status.lastError) {
                <span i18n class="tb-tag tb-tag-danger"><i class="pi pi-exclamation-triangle"></i>Erreur</span>
              } @else if (alerts.active().length) {
                <span i18n class="tb-tag tb-tag-danger"><i class="pi pi-exclamation-circle"></i>{{ alerts.active().length }} en cours</span>
              } @else {
                <span i18n class="tb-tag tb-tag-success"><i class="pi pi-check"></i>Tout va bien</span>
              }
            }
          </div>

          @for (a of alerts.active(); track a.id) {
            <div class="tb-pref tb-alert-event">
              <span class="tb-section-icon tb-alert-hot"><i class="pi pi-exclamation-circle"></i></span>
              <div class="tb-pref-text">
                <strong>{{ a.roomName ?? ('Salle supprimée' | tr) }} · {{ unit.withSymbol(a.lastTemperature ?? a.temperature) }}</strong>
                <span class="tb-muted">{{ eventText(a) }}</span>
                @if (a.deliveryFailed) {
                  <span i18n class="tb-field-error"><i class="pi pi-exclamation-triangle"></i> Un message n'a pas pu partir.</span>
                }
              </div>
            </div>
          }

          @for (d of alerts.failed().slice(0, 3); track d.id) {
            <div class="tb-pref tb-alert-failed">
              <span class="tb-section-icon"><i class="pi pi-send"></i></span>
              <div class="tb-pref-text">
                <strong i18n>Message non envoyé · {{ d.channelName }}</strong>
                <span class="tb-muted">{{ when(d.createdAt) }}@if (d.attempts > 1) { · {{ d.attempts }} {{ 'essais' | tr }} } · {{ d.lastError ?? ('Erreur inconnue' | tr) }}</span>
              </div>
            </div>
          }
        </div>
        <p i18n class="tb-muted tb-pref-scope">
          <i class="pi pi-shield"></i> Le serveur surveille les salles lui-même, qu'un client soit ouvert ou non. Les notifications des applications restent telles quelles.
        </p>
      </section>

      <!-- Channels -->
      <section class="tb-panel tb-pref-group tb-pref-admin tb-alerts" aria-labelledby="tb-alert-channels-title">
        <div class="tb-alert-head">
          <h2 i18n class="tb-pref-heading" id="tb-alert-channels-title">Canaux</h2>
          <button i18n type="button" class="tb-btn tb-tonal" [disabled]="!status" (click)="channelSheet().create()"><i class="pi pi-plus"></i>Ajouter</button>
        </div>
        <div class="tb-prefs">
          @for (c of alerts.channels(); track c.id) {
            <div class="tb-pref tb-alert-item" [class.tb-alert-off]="!c.enabled">
              <span class="tb-section-icon"><i class="pi" [class]="channelIcon(c)"></i></span>
              <div class="tb-pref-text">
                <strong>{{ c.name }}</strong>
                <span class="tb-muted">{{ channelText(c) }}</span>
                @if (c.secretUnreadable) {
                  <span i18n class="tb-field-error"><i class="pi pi-exclamation-triangle"></i> Secrets illisibles : modifie le canal pour les saisir à nouveau.</span>
                }
              </div>
              <div class="tb-pref-actions">
                <button i18n type="button" class="tb-btn tb-flat" [disabled]="testing() === c.id || !c.enabled" (click)="test(c)">
                  <i class="pi" [class.pi-send]="testing() !== c.id" [class.pi-spin]="testing() === c.id" [class.pi-spinner]="testing() === c.id"></i>Tester
                </button>
                <button type="button" class="tb-btn tb-icon tb-flat" i18n-title title="Modifier" [attr.aria-label]="('Modifier ' | tr) + c.name" (click)="channelSheet().edit(c)">
                  <i class="pi pi-pencil"></i>
                </button>
                <tb-switch [checked]="c.enabled" [disabled]="switching() === 'c' + c.id" [label]="c.name" (checkedChange)="enableChannel(c, $event)" />
              </div>
            </div>
          } @empty {
            <div class="tb-pref tb-alert-empty">
              <span class="tb-section-icon"><i class="pi pi-envelope"></i></span>
              <div class="tb-pref-text">
                <strong i18n>Aucun canal</strong>
                <span i18n class="tb-muted">Un e-mail (serveur SMTP) ou un webhook (Discord, Slack, Teams, n8n…) : où envoyer les alertes.</span>
              </div>
            </div>
          }
        </div>
      </section>

      <!-- Rules -->
      <section class="tb-panel tb-pref-group tb-pref-admin tb-alerts" aria-labelledby="tb-alert-rules-title">
        <div class="tb-alert-head">
          <h2 i18n class="tb-pref-heading" id="tb-alert-rules-title">Règles</h2>
          <button i18n type="button" class="tb-btn tb-tonal" [disabled]="!status" (click)="ruleSheet().create()"><i class="pi pi-plus"></i>Ajouter</button>
        </div>
        <div class="tb-prefs">
          @for (r of alerts.rules(); track r.id) {
            <div class="tb-pref tb-alert-item" [class.tb-alert-off]="!r.enabled">
              <span class="tb-section-icon"><i class="pi" [class.pi-globe]="r.global" [class.pi-sitemap]="!r.global"></i></span>
              <div class="tb-pref-text">
                <strong>{{ r.name }}</strong>
                <span class="tb-muted">{{ ruleText(r) }}</span>
                <span class="tb-muted">{{ ruleTargets(r) }}</span>
              </div>
              <div class="tb-pref-actions">
                <button type="button" class="tb-btn tb-icon tb-flat" i18n-title title="Modifier" [attr.aria-label]="('Modifier ' | tr) + r.name" (click)="ruleSheet().edit(r)">
                  <i class="pi pi-pencil"></i>
                </button>
                <tb-switch [checked]="r.enabled" [disabled]="switching() === 'r' + r.id" [label]="r.name" (checkedChange)="enableRule(r, $event)" />
              </div>
            </div>
          } @empty {
            <div class="tb-pref tb-alert-empty">
              <span class="tb-section-icon"><i class="pi pi-filter"></i></span>
              <div class="tb-pref-text">
                <strong i18n>Aucune règle</strong>
                <span i18n class="tb-muted">Quand alerter (écart à la consigne, durée), où (toute l'installation ou certains bâtiments, étages, salles) et quels canaux prévenir.</span>
              </div>
            </div>
          }
        </div>
      </section>

      <tb-alert-channel-sheet />
      <tb-alert-rule-sheet />
    }
  `,
})
export class TbAlertSettings implements OnDestroy {
  protected readonly alerts = inject(AlertStore);
  protected readonly unit = inject(UnitService);
  private readonly toasts = inject(ToastService);

  protected readonly channelSheet = viewChild.required(TbAlertChannelSheet);
  protected readonly ruleSheet = viewChild.required(TbAlertRuleSheet);
  /** The channel being tested. */
  protected readonly testing = signal<number | null>(null);
  /** The channel (c12) or rule (r3) being turned on or off. */
  protected readonly switching = signal<string | null>(null);

  constructor() {
    this.alerts.watch();
  }

  ngOnDestroy(): void {
    this.alerts.stop();
  }

  protected when(d: Parameters<typeof ddmmAtHHmm>[0]): string {
    const date = parseDate(d);
    if (!date) return '';
    return date.toDateString() === new Date().toDateString() ? $localize`à ${clockTime(date)}` : ddmmAtHHmm(date);
  }

  protected monitorText(): string {
    const s = this.alerts.status();
    if (!s) return '';
    const parts: string[] = [];
    parts.push(s.watchedRooms > 1 ? $localize`${s.watchedRooms} salles surveillées` : s.watchedRooms === 1 ? $localize`1 salle surveillée` : $localize`Aucune salle sous une règle`);
    if (s.lastRun) parts.push($localize`dernier passage ${this.when(s.lastRun)}`);
    else if (!s.running) parts.push($localize`pas encore démarrée`);
    if (s.runByAnotherServer) parts.push($localize`par un autre serveur de la même base`);
    return parts.join(' · ');
  }

  protected eventText(a: AlertEvent): string {
    const parts = [a.place, $localize`consigne ${this.unit.withSymbol(a.currentSetpoint ?? a.setpoint)}`, $localize`maximum ${this.unit.withSymbol(a.peak)}`];
    const since = a.exceededSince ?? a.triggeredAt;
    if (since) parts.push($localize`depuis ${this.when(since)}`);
    parts.push(a.ruleName);
    return parts.filter(Boolean).join(' · ');
  }

  protected channelIcon(c: AlertChannel): string {
    if (c.kind === 'EMAIL') return 'pi-envelope';
    return ({ DISCORD: 'pi-discord', SLACK: 'pi-slack', GENERIC: 'pi-link' } as const)[c.webhook?.format ?? 'GENERIC'];
  }

  protected channelText(c: AlertChannel): string {
    if (c.email) {
      const n = c.email.recipients.length;
      return [$localize`E-mail`, n > 1 ? $localize`${n} destinataires` : (c.email.recipients[0] ?? ''), c.email.host].filter(Boolean).join(' · ');
    }
    const w = c.webhook;
    const format = ({ DISCORD: 'Discord', SLACK: 'Slack', GENERIC: $localize`Webhook JSON` } as const)[w?.format ?? 'GENERIC'];
    return [format, w?.urlPreview ?? (w?.urlSet ? '' : $localize`sans adresse`)].filter(Boolean).join(' · ');
  }

  protected ruleText(r: AlertRule): string {
    const parts = [
      $localize`${this.unit.delta(r.tolerance)}:delta: au-dessus de la consigne pendant ${duration(r.minDurationSeconds)}:duration:`,
      r.reminderSeconds ? $localize`rappel toutes les ${duration(r.reminderSeconds)}` : '',
      r.notifyResolution ? $localize`fin signalée` : '',
    ];
    return parts.filter(Boolean).join(' · ');
  }

  protected ruleTargets(r: AlertRule): string {
    const where = r.global ? $localize`Toute l'installation` : r.scope.map((e) => e.name ?? $localize`élément supprimé`).join(', ');
    const whom = r.channels.length ? r.channels.map((c) => c.name ?? $localize`canal supprimé`).join(', ') : $localize`aucun canal`;
    return `${where} → ${whom}`;
  }

  protected async test(c: AlertChannel): Promise<void> {
    this.testing.set(c.id);
    try {
      const d = await this.alerts.testChannel(c.id);
      if (d.status === 'SENT') this.toasts.info($localize`Message de test envoyé par « ${c.name} »`);
      else if (d.status === 'PENDING') this.toasts.info($localize`Message de test en attente`, d.lastError);
      else this.toasts.error($localize`Message de test non envoyé`, d.lastError ? explain(d.lastError) : null);
    } catch (e) {
      this.toasts.error($localize`Test impossible`, errorMessage(e));
    } finally {
      this.testing.set(null);
    }
  }

  protected async enableChannel(c: AlertChannel, enabled: boolean): Promise<void> {
    this.switching.set('c' + c.id);
    try {
      await this.alerts.enableChannel(c.id, enabled);
      this.toasts.info(enabled ? $localize`Canal « ${c.name} » activé` : $localize`Canal « ${c.name} » coupé`);
    } catch (e) {
      this.toasts.error($localize`Réglage non enregistré`, errorMessage(e));
    } finally {
      this.switching.set(null);
    }
  }

  protected async enableRule(r: AlertRule, enabled: boolean): Promise<void> {
    this.switching.set('r' + r.id);
    try {
      await this.alerts.enableRule(r.id, enabled);
      this.toasts.info(enabled ? $localize`Règle « ${r.name} » activée` : $localize`Règle « ${r.name} » coupée`, enabled ? null : $localize`Ses alertes en cours sont annulées.`);
    } catch (e) {
      this.toasts.error($localize`Réglage non enregistré`, errorMessage(e));
    } finally {
      this.switching.set(null);
    }
  }
}
