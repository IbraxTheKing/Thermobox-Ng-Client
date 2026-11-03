
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { errorMessage } from '../../core/api.config';
import { ToastService } from '../../core/messages';
import { UnitService, parseNumber } from '../../core/unit';
import { TemperatureLimits } from '../../models/models';
import { ABSOLUTE_LIMITS, ServerFeaturesService } from '../../services/server-features.service';
import { AlertChannelRequest, AlertRuleRequest } from '../../models/models';
import { AuthService } from '../../core/auth';
import { TrPipe } from '../../ui/tr.pipe';

@Component({
  selector: 'tb-server-settings',
  imports: [TrPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tb-panel tb-pref-server">
      @if (auth.admin()) {
        <!-- Logo -->
        <div class="tb-pref tb-pref-logo">
          <span class="tb-server-logo-preview">
            @if (features.logo(); as l) {
              <img [src]="l" i18n-alt alt="Logo du serveur" />
            } @else {
              <i class="pi pi-server"></i>
            }
          </span>

          <div class="tb-pref-text">
            <strong i18n>Logo</strong>
            <span i18n class="tb-muted">
              {{ logoSource() }} Affiché à côté du serveur dans la liste des comptes de chacun.
            </span>
          </div>

          <div class="tb-pref-actions">
            <label i18n class="tb-btn tb-tonal" [class.tb-disabled]="logoSaving()">
              <i class="pi pi-upload"></i>
              Changer
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/svg+xml"
                hidden
                [disabled]="logoSaving()"
                (change)="changeLogo($event)"
              />
            </label>

            @if (features.info()?.logoSource === 'custom') {
              <button
                i18n
                type="button"
                class="tb-btn tb-flat"
                [disabled]="logoSaving()"
                (click)="resetLogo()"
              >
                Automatique
              </button>
            }
          </div>
        </div>

        <!-- Limits -->
        <form class="tb-pref tb-pref-limits" (submit)="saveLimits($event)">
          <span class="tb-section-icon">
            <i class="pi pi-sliders-h"></i>
          </span>

          <div class="tb-pref-text">
            <strong i18n>Températures acceptées</strong>
            <span i18n class="tb-muted">
              Une consigne hors de ces bornes est refusée ; une mesure hors bornes est prise pour une erreur de capteur et ignorée.
            </span>

            <div class="tb-limits">
              @for (l of limitRows; track l.key) {
                <fieldset class="tb-limits-row">
                  <legend>{{ l.label }}</legend>

                  <label i18n>
                    de
                    <input
                      class="tb-input"
                      type="number"
                      inputmode="decimal"
                      step="0.5"
                      [value]="limitValue(l.key, 'min')"
                      (input)="setLimit(l.key, 'min', $event)"
                      [attr.aria-label]="l.label + (' minimale' | tr)"
                    />
                  </label>

                  <label i18n>
                    à
                    <input
                      class="tb-input"
                      type="number"
                      inputmode="decimal"
                      step="0.5"
                      [value]="limitValue(l.key, 'max')"
                      (input)="setLimit(l.key, 'max', $event)"
                      [attr.aria-label]="l.label + (' maximale' | tr)"
                    />
                  </label>

                  <span class="tb-muted">{{ unit.symbol() }}</span>
                </fieldset>
              }
            </div>

            @if (limitsError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            }

            <div class="tb-limits-actions">
              <button
                i18n
                type="submit"
                class="tb-btn"
                [disabled]="limitsSaving() || !limitsChanged()"
              >
                Enregistrer
              </button>

              <button
                i18n
                type="button"
                class="tb-btn tb-flat"
                [disabled]="limitsSaving()"
                (click)="resetLimits()"
              >
                Valeurs par défaut
              </button>
            </div>
          </div>
        </form>

        <!-- Alerts Section -->
        <hr class="tb-divider">

        <div class="tb-pref">
          <span class="tb-section-icon">
            <i class="pi pi-bell"></i>
          </span>

          <div class="tb-pref-text">
            <strong i18n>Alertes</strong>
            <p class="tb-muted" i18n>
              Configurez les canaux et règles pour recevoir des notifications en cas d'anomalie de température.
            </p>
          </div>

          <!-- Channels -->
          <div class="tb-pref tb-pref-channels">
            <span class="tb-section-icon">
              <i class="pi pi-plug"></i>
            </span>

            <div class="tb-pref-text">
              <strong i18n>Canaux d'alerte</strong>

              <div class="tb-list" style="margin-top: 0.5rem;">
                @for (c of features.channels(); track c.id) {
                  <div class="tb-list-item">
                    <span>
                      {{ c.name }}
                      <small>({{ c.kind }})</small>
                    </span>

                    <span
                      [class]="c.enabled
                        ? 'pi pi-check text-green-500'
                        : 'pi pi-times text-red-500'"
                    ></span>

                    <button
                      i18n
                      type="button"
                      class="tb-btn tb-flat ml-2"
                      (click)="deleteChannel(c.id!)"
                    >
                      Supprimer
                    </button>
                  </div>
                } @empty {
                  <span class="tb-muted">Aucun canal configuré.</span>
                }
              </div>

              <button
                i18n
                type="button"
                class="tb-btn tb-tonal"
                (click)="toggleChannelForm()"
              >
                Ajouter un canal
              </button>
            </div>

            @if (showChannelForm()) {
              <form
                class="tb-pref tb-pref-limits"
                style="margin-top: 1rem; border: 1px solid var(--border-color); padding: 1rem;"
                (submit)="saveChannels($event)"
              >
                <div class="tb-prefs">
                  <strong i18n>Nouveau canal</strong>

                  <input
                    type="text"
                    class="tb-input"
                    style="width: 100%; margin-bottom: 0.5rem;"
                    placeholder="Nom du canal"
                    name="channelName"
                    [(ngModel)]="newChannelRequest.name"
                    required
                  />

                  <select
                    class="tb-input"
                    style="width: 100%; margin-bottom: 0.5rem;"
                    name="channelKind"
                    [(ngModel)]="newChannelRequest.kind"
                  >
                    <option value="EMAIL">Email</option>
                    <option value="WEBHOOK">Webhook</option>
                  </select>

                  @if (newChannelRequest.kind === 'EMAIL') {
                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Hôte :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="emailHost"
                        [(ngModel)]="newChannelRequest.email.host"
                        placeholder="smtp.example.com"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Port :</label>
                      <input
                        type="number"
                        class="tb-input"
                        name="emailPort"
                        [(ngModel)]="newChannelRequest.email.port"
                        placeholder="587"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Sécurité :</label>
                      <select
                        class="tb-input"
                        name="emailSecurity"
                        [(ngModel)]="newChannelRequest.email.security"
                      >
                        <option value="NONE">Aucune</option>
                        <option value="STARTTLS">STARTTLS</option>
                        <option value="SSL">SSL</option>
                      </select>
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Utilisateur :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="emailUsername"
                        [(ngModel)]="newChannelRequest.email.username"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Mot de passe :</label>
                      <input
                        type="password"
                        class="tb-input"
                        name="emailPassword"
                        [(ngModel)]="newChannelRequest.email.password"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Expéditeur :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="emailFrom"
                        [(ngModel)]="newChannelRequest.email.from"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Nom d'affichage :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="emailFromName"
                        [(ngModel)]="newChannelRequest.email.fromName"
                      />
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Destinataires (virgules) :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="emailRecipients"
                        [(ngModel)]="newChannelRequest.email.recipientsStr"
                      />
                    </div>
                  } @else {
                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>Format :</label>
                      <select
                        class="tb-input"
                        name="webhookFormat"
                        [(ngModel)]="newChannelRequest.webhook.format"
                      >
                        <option value="DISCORD">Discord</option>
                        <option value="SLACK">Slack</option>
                        <option value="GENERIC">Générique</option>
                      </select>
                    </div>

                    <div class="tb-input" style="margin-bottom: 0.5rem;">
                      <label i18n>URL :</label>
                      <input
                        type="text"
                        class="tb-input"
                        name="webhookUrl"
                        [(ngModel)]="newChannelRequest.webhook.url"
                      />
                    </div>
                  }
                </div>

                <div class="tb-limits-actions">
                  <button
                    i18n
                    type="submit"
                    class="tb-btn"
                    [disabled]="channelsSaving()"
                  >
                    Enregistrer
                  </button>

                  <button
                    i18n
                    type="button"
                    class="tb-btn tb-flat"
                    (click)="toggleChannelForm(false)"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            }
          </div>

          <!-- Rules -->
          <div class="tb-pref tb-pref-rules">
            <span class="tb-section-icon">
              <i class="pi pi-filter"></i>
            </span>

            <div class="tb-pref-text">
              <strong i18n>Règles d'alerte</strong>

              <div class="tb-list" style="margin-top: 0.5rem;">
                @for (r of features.rules(); track r.id) {
                  <div class="tb-list-item">
                    <span>
                      {{ r.name }}
                      <small>({{ r.enabled ? 'Actif' : 'Inactif' }})</small>
                    </span>

                    <button
                      i18n
                      type="button"
                      class="tb-btn tb-flat ml-2"
                      (click)="deleteRule(r.id!)"
                    >
                      Supprimer
                    </button>
                  </div>
                } @empty {
                  <span class="tb-muted">Aucune règle configurée.</span>
                }
              </div>

              <button
                i18n
                type="button"
                class="tb-btn tb-tonal"
                (click)="toggleRulesForm()"
              >
                Ajouter une règle
              </button>
            </div>

            @if (showRulesForm()) {
              <form
                class="tb-pref tb-pref-limits"
                style="margin-top: 1rem; border: 1px solid var(--border-color); padding: 1rem;"
                (submit)="saveRules($event)"
              >
                <div class="tb-prefs">
                  <strong i18n>Nouvelle règle</strong>

                  <input
                    type="text"
                    class="tb-input"
                    style="width: 100%; margin-bottom: 0.5rem;"
                    placeholder="Nom de la règle"
                    name="ruleName"
                    [(ngModel)]="newRuleRequest.name"
                    required
                  />

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Tolérance (°C) :</label>
                    <input
                      type="number"
                      step="0.1"
                      class="tb-input"
                      name="ruleTolerance"
                      [(ngModel)]="newRuleRequest.tolerance"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Durée min (sec) :</label>
                    <input
                      type="number"
                      class="tb-input"
                      name="ruleMinDuration"
                      [(ngModel)]="newRuleRequest.minDurationSeconds"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Durée de résolution (sec) :</label>
                    <input
                      type="number"
                      class="tb-input"
                      name="ruleClearAfter"
                      [(ngModel)]="newRuleRequest.clearAfterSeconds"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Rappel toutes les (sec) :</label>
                    <input
                      type="number"
                      class="tb-input"
                      name="ruleReminder"
                      [(ngModel)]="newRuleRequest.reminderSeconds"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Notifier résolution :</label>
                    <input
                      type="checkbox"
                      name="ruleNotifyResolution"
                      [(ngModel)]="newRuleRequest.notifyResolution"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Global :</label>
                    <input
                      type="checkbox"
                      name="ruleGlobal"
                      [(ngModel)]="newRuleRequest.global"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Pièces (IDs virgules) :</label>
                    <input
                      type="text"
                      class="tb-input"
                      name="ruleScope"
                      [(ngModel)]="newRuleRequest.scopeStr"
                    />
                  </div>

                  <div class="tb-input" style="margin-bottom: 0.5rem;">
                    <label i18n>Canaux (IDs virgules) :</label>
                    <input
                      type="text"
                      class="tb-input"
                      name="ruleChannels"
                      [(ngModel)]="newRuleRequest.channelsStr"
                    />
                  </div>
                </div>

                <div class="tb-limits-actions">
                  <button
                    i18n
                    type="submit"
                    class="tb-btn"
                    [disabled]="rulesSaving()"
                  >
                    Enregistrer
                  </button>

                  <button
                    i18n
                    type="button"
                    class="tb-btn tb-flat"
                    (click)="toggleRulesForm(false)"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class ServerSettings {
  protected readonly features = inject(ServerFeaturesService);
  protected readonly unit = inject(UnitService);
  private readonly toasts = inject(ToastService);
  protected readonly auth = inject(AuthService);

  protected readonly logoSaving = signal(false);

  protected readonly logoSource = computed(() =>
    ({
      custom: $localize`Choisi par un administrateur.`,
      site: $localize`Celui du site du serveur.`,
      default: $localize`Celui de ThermoBox.`,
    })[this.features.info()?.logoSource ?? 'default'] ?? ''
  );

  protected readonly limitRows: {
    key: keyof TemperatureLimits;
    label: string;
  }[] = [
    { key: 'setpoint', label: $localize`Consigne` },
    { key: 'measurement', label: $localize`Mesure` },
  ];

  private readonly typed = signal<
    Partial<Record<`${keyof TemperatureLimits}.${'min' | 'max'}`, number | null>>
  >({});

  protected readonly limitsSaving = signal(false);
  protected readonly limitsError = signal<string | null>(null);
  protected readonly limitsChanged = computed(
    () => Object.keys(this.typed()).length > 0
  );

  protected channelsSaving = signal(false);
  protected rulesSaving = signal(false);
  protected showChannelForm = signal(false);
  protected showRulesForm = signal(false);

  newChannelRequest = {
    name: '',
    kind: 'EMAIL',
    enabled: true,
    email: {
      host: '',
      port: 587,
      security: 'STARTTLS',
      username: '',
      password: '',
      from: '',
      fromName: '',
      recipients: [] as string[],
      recipientsStr: '',
      template: '',
    },
    webhook: {
      format: 'DISCORD',
      url: '',
      authorization: '',
      signingSecret: '',
      template: '',
    },
  };

  newRuleRequest = {
    name: '',
    enabled: true,
    tolerance: 1.0,
    minDurationSeconds: 600,
    clearAfterSeconds: 600,
    reminderSeconds: 0,
    notifyResolution: true,
    global: false,
    scopeStr: '',
    channelsStr: '',
  };

  protected limitValue(
    k: keyof TemperatureLimits,
    b: 'min' | 'max'
  ): string {
    const t = this.typed()[`${k}.${b}`];
    return t == null ? '' : String(t);
  }

  protected setLimit(
    k: keyof TemperatureLimits,
    b: 'min' | 'max',
    e: Event
  ): void {
    const v = parseNumber((e.target as HTMLInputElement).value);

    this.typed.update(t => ({
      ...t,
      [`${k}.${b}`]: v,
    }));

    this.limitsError.set(null);
  }

  async saveLimits(e: Event) {
    e.preventDefault();

    const current = this.features.limits();
    if (!current) return;

    const limits = structuredClone(current);

    for (const [path, v] of Object.entries(this.typed())) {
      const [k, b] = path.split('.') as [
        keyof TemperatureLimits,
        'min' | 'max'
      ];

      if (v == null) {
        return this.limitsError.set(
          $localize`Chaque borne doit être un nombre`
        );
      }

      limits[k][b] = this.unit.inputToCelsius(v);
    }

    for (const l of this.limitRows) {
      if (limits[l.key].min >= limits[l.key].max) {
        return this.limitsError.set(
          $localize`${l.label} : le minimum doit être plus bas que le maximum`
        );
      }

      if (
        limits[l.key].min < ABSOLUTE_LIMITS.min ||
        limits[l.key].max > ABSOLUTE_LIMITS.max
      ) {
        return this.limitsError.set(
          $localize`Les bornes restent entre ${this.unit.withSymbol(ABSOLUTE_LIMITS.min)} et ${this.unit.withSymbol(ABSOLUTE_LIMITS.max)}`
        );
      }
    }

    this.limitsSaving.set(true);

    try {
      await this.features.saveLimits(limits);
      this.typed.set({});
      this.toasts.info('Températures acceptées enregistrées');
    } catch (err) {
      this.limitsError.set(errorMessage(err));
    } finally {
      this.limitsSaving.set(false);
    }
  }

  async resetLimits() {
    this.limitsSaving.set(true);

    try {
      await this.features.resetLimits();
      this.typed.set({});
      this.toasts.info('Températures acceptées : valeurs par défaut');
    } catch (err) {
      this.toasts.error(
        'Réglage non enregistré',
        errorMessage(err)
      );
    } finally {
      this.limitsSaving.set(false);
    }
  }

  async changeLogo(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];

    input.value = '';

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      return this.toasts.error('Logo trop lourd', '5 Mo au plus');
    }

    this.logoSaving.set(true);

    try {
      await this.features.setLogo(file);
      this.toasts.info('Logo du serveur changé');
    } catch (err) {
      this.toasts.error('Logo non enregistré', errorMessage(err));
    } finally {
      this.logoSaving.set(false);
    }
  }

  async resetLogo() {
    this.logoSaving.set(true);

    try {
      await this.features.resetLogo();
      this.toasts.info('Logo automatique');
    } catch (err) {
      this.toasts.error('Logo non enregistré', errorMessage(err));
    } finally {
      this.logoSaving.set(false);
    }
  }

  toggleChannelForm(show?: boolean): void {
    this.showChannelForm.set(show ?? !this.showChannelForm());
  }

  async saveChannels(e: Event) {
    e.preventDefault();

    const req = this.newChannelRequest;

    const requestBody: any = {
      name: req.name,
      kind: req.kind,
      enabled: req.enabled,
    };

    if (req.kind === 'EMAIL') {
      requestBody.email = {
        host: req.email.host,
        port: req.email.port,
        security: req.email.security,
        username: req.email.username,
        password: req.email.password,
        from: req.email.from,
        fromName: req.email.fromName,
        recipients: req.email.recipientsStr
          ? req.email.recipientsStr.split(',').map(s => s.trim())
          : [],
        template: req.email.template,
      };
    } else {
      requestBody.webhook = {
        format: req.webhook.format,
        url: req.webhook.url,
        authorization: req.webhook.authorization,
        signingSecret: req.webhook.signingSecret,
        template: req.webhook.template,
      };
    }

    this.channelsSaving.set(true);

    try {
      await this.features.saveChannels(
        requestBody as AlertChannelRequest
      );

      this.toasts.info("Canal d'alerte enregistré");
      this.toggleChannelForm(false);

      this.newChannelRequest = {
        name: '',
        kind: 'EMAIL',
        enabled: true,
        email: {
          host: '',
          port: 587,
          security: 'STARTTLS',
          username: '',
          password: '',
          from: '',
          fromName: '',
          recipients: [],
          recipientsStr: '',
          template: '',
        },
        webhook: {
          format: 'DISCORD',
          url: '',
          authorization: '',
          signingSecret: '',
          template: '',
        },
      };
    } catch (err) {
      this.toasts.error(
        "Erreur lors de l'enregistrement du canal",
        errorMessage(err)
      );
    } finally {
      this.channelsSaving.set(false);
    }
  }

  toggleRulesForm(show?: boolean): void {
    this.showRulesForm.set(show ?? !this.showRulesForm());
  }

  async saveRules(e: Event) {
    e.preventDefault();

    const req = this.newRuleRequest;

    const requestBody: any = {
      name: req.name,
      enabled: req.enabled,
      tolerance: req.tolerance,
      minDurationSeconds: req.minDurationSeconds,
      clearAfterSeconds: req.clearAfterSeconds,
      reminderSeconds: req.reminderSeconds,
      notifyResolution: req.notifyResolution,
      global: req.global,
      scope: req.scopeStr
        ? req.scopeStr.split(',').map(s => parseInt(s.trim(), 10))
        : [],
      channels: req.channelsStr
        ? req.channelsStr.split(',').map(s => parseInt(s.trim(), 10))
        : [],
    };

    this.rulesSaving.set(true);

    try {
      await this.features.saveRules(
        requestBody as AlertRuleRequest
      );

      this.toasts.info("Règle d'alerte enregistrée");
      this.toggleRulesForm(false);

      this.newRuleRequest = {
        name: '',
        enabled: true,
        tolerance: 1.0,
        minDurationSeconds: 600,
        clearAfterSeconds: 600,
        reminderSeconds: 0,
        notifyResolution: true,
        global: false,
        scopeStr: '',
        channelsStr: '',
      };
    } catch (err) {
      this.toasts.error(
        "Erreur lors de l'enregistrement de la règle",
        errorMessage(err)
      );
    } finally {
      this.rulesSaving.set(false);
    }
  }

  protected async deleteChannel(id: number): Promise<void> {
    try {
      await this.features.deleteChannel(id);
      this.toasts.info('Canal supprimé');
    } catch (err) {
      this.toasts.error(
        'Erreur lors de la suppression du canal',
        errorMessage(err)
      );
    }
  }

  protected async deleteRule(id: number): Promise<void> {
    try {
      await this.features.deleteRule(id);
      this.toasts.info('Règle supprimée');
    } catch (err) {
      this.toasts.error(
        'Erreur lors de la suppression de la règle',
        errorMessage(err)
      );
    }
  }
}
