import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { ConfirmService, ToastService } from '../../core/messages';
import { AlertChannel, AlertChannelKind, AlertChannelRequest, SmtpSecurity, WebhookFormat } from '../../models/models';
import { AlertStore } from '../../services/alert.store';
import { TbPassword } from '../../ui/controls';
import { TbSheet } from '../../ui/sheet';
import { TrPipe } from '../../ui/tr.pipe';
import { TEMPLATE_FIELDS, explain } from './alert-text';

/** Ports of each kind of encryption: one left as the default follows the encryption chosen. */
const PORTS: Record<SmtpSecurity, number> = { STARTTLS: 587, SSL: 465, NONE: 25 };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;

/**
 * A channel of the temperature alerts (ADMIN, 26.12): an email account, or a webhook (Discord,
 * Slack and those that read its JSON, or any service with the whole alert in JSON). Created,
 * changed or deleted. The secrets (password, URL, headers) are never read back: an empty field
 * keeps the one saved.
 *
 *   <tb-alert-channel-sheet />   …   sheet.create() / sheet.edit(channel) / sheet.remove(channel)
 */
@Component({
  selector: 'tb-alert-channel-sheet',
  imports: [TrPipe, TbSheet, TbPassword],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" [title]="creation() ? ('Nouveau canal' | tr) : ('Modifier le canal' | tr)" [width]="520">
      <form (submit)="save($event)" novalidate>
        @if (channel()?.secretUnreadable) {
          <p i18n class="tb-field-error tb-alert-sheet-note">
            <i class="pi pi-exclamation-triangle"></i> Les secrets enregistrés ne peuvent plus être lus (la clé du serveur a changé) : saisis-les à nouveau.
          </p>
        }
        <div class="tb-field">
          <label i18n class="tb-label" for="tb-ac-name">Nom</label>
          <input id="tb-ac-name" class="tb-input" autocomplete="off" maxlength="100" i18n-placeholder placeholder="Astreinte, Discord technique…"
                 [value]="name()" (input)="name.set($any($event.target).value)" [class.tb-invalid]="submitted() && nameError()" />
          @if (submitted() && nameError(); as e) {
            <span class="tb-field-error">{{ e }}</span>
          }
        </div>

        <div class="tb-field">
          <span i18n class="tb-label">Type</span>
          <div class="tb-segmented tb-alert-kind" role="radiogroup" i18n-aria-label aria-label="Type de canal">
            @for (k of kinds; track k.id) {
              <button type="button" role="radio" [attr.aria-checked]="kind() === k.id" [class.tb-seg-on]="kind() === k.id" [disabled]="!creation()" (click)="kind.set(k.id)">
                {{ k.label }}
              </button>
            }
          </div>
          @if (!creation()) {
            <span i18n class="tb-field-hint">Le type ne change pas : crée un autre canal pour en changer.</span>
          }
        </div>

        @if (kind() === 'EMAIL') {
          <div class="tb-field-row tb-alert-smtp">
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-host">Serveur SMTP</label>
              <input id="tb-ac-host" class="tb-input" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url" placeholder="smtp.example.org"
                     [value]="host()" (input)="host.set($any($event.target).value)" [class.tb-invalid]="submitted() && hostError()" />
              @if (submitted() && hostError(); as e) {
                <span class="tb-field-error">{{ e }}</span>
              }
            </div>
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-port">Port</label>
              <input id="tb-ac-port" class="tb-input" type="number" inputmode="numeric" min="1" max="65535"
                     [value]="port() ?? ''" (input)="port.set(int($any($event.target).value))" [class.tb-invalid]="submitted() && portError()" />
              @if (submitted() && portError(); as e) {
                <span class="tb-field-error">{{ e }}</span>
              }
            </div>
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ac-security">Chiffrement</label>
            <select id="tb-ac-security" class="tb-select" (change)="setSecurity($any($event.target).value)">
              @for (s of securities; track s.id) {
                <option [value]="s.id" [selected]="security() === s.id">{{ s.label }}</option>
              }
            </select>
          </div>
          <div class="tb-field-row">
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-user">Identifiant (facultatif)</label>
              <input id="tb-ac-user" class="tb-input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="255"
                     [value]="username()" (input)="username.set($any($event.target).value)" />
            </div>
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-password">Mot de passe</label>
              <tb-password inputId="tb-ac-password" [(value)]="password" autocomplete="new-password" />
              @if (passwordSet()) {
                <span class="tb-field-hint">
                  <ng-container i18n>Enregistré : laisse vide pour le garder.</ng-container>
                  <button i18n type="button" class="tb-link-btn" (click)="clearPassword()">Le retirer</button>
                </span>
              } @else if (passwordCleared()) {
                <span i18n class="tb-field-hint">Retiré à l'enregistrement.</span>
              }
            </div>
          </div>
          <div class="tb-field-row">
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-from">Adresse de l'expéditeur</label>
              <input id="tb-ac-from" class="tb-input" type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="thermobox@example.org"
                     [value]="from()" (input)="from.set($any($event.target).value)" [class.tb-invalid]="submitted() && fromError()" />
              @if (submitted() && fromError(); as e) {
                <span class="tb-field-error">{{ e }}</span>
              }
            </div>
            <div class="tb-field">
              <label i18n class="tb-label" for="tb-ac-from-name">Nom de l'expéditeur (facultatif)</label>
              <input id="tb-ac-from-name" class="tb-input" autocomplete="off" maxlength="100" placeholder="ThermoBox"
                     [value]="fromName()" (input)="fromName.set($any($event.target).value)" />
            </div>
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ac-to">Destinataires</label>
            <textarea id="tb-ac-to" class="tb-input tb-textarea" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="astreinte@example.org"
                      [value]="recipients()" (input)="recipients.set($any($event.target).value)" [class.tb-invalid]="submitted() && recipientsError()"></textarea>
            @if (submitted() && recipientsError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            } @else {
              <span i18n class="tb-field-hint">Une adresse par ligne (ou séparées par des virgules), 50 au plus.</span>
            }
          </div>
        } @else {
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ac-format">Format</label>
            <select id="tb-ac-format" class="tb-select" (change)="format.set($any($event.target).value)">
              @for (f of formats; track f.id) {
                <option [value]="f.id" [selected]="format() === f.id">{{ f.label }}</option>
              }
            </select>
            <span class="tb-field-hint">{{ formatHint() }}</span>
          </div>
          <div class="tb-field">
            <label i18n class="tb-label" for="tb-ac-url">Adresse du webhook</label>
            <input id="tb-ac-url" class="tb-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
                   [placeholder]="urlPreview() ?? 'https://…'" [value]="url()" (input)="url.set($any($event.target).value)" [class.tb-invalid]="submitted() && urlError()" />
            @if (submitted() && urlError(); as e) {
              <span class="tb-field-error">{{ e }}</span>
            } @else if (urlSet()) {
              <span i18n class="tb-field-hint">Enregistrée ({{ urlPreview() }}) : laisse vide pour la garder.</span>
            } @else {
              <span i18n class="tb-field-hint">En HTTPS, vers une adresse publique. Elle contient souvent un jeton : elle n'est jamais réaffichée.</span>
            }
          </div>
          @if (format() === 'GENERIC' || authorizationSet() || signingSecretSet()) {
            <div class="tb-field-row">
              <div class="tb-field">
                <label i18n class="tb-label" for="tb-ac-auth">En-tête Authorization (facultatif)</label>
                <tb-password inputId="tb-ac-auth" [(value)]="authorization" autocomplete="off" />
                @if (authorizationSet()) {
                  <span class="tb-field-hint">
                    <ng-container i18n>Enregistré.</ng-container>
                    <button i18n type="button" class="tb-link-btn" (click)="authorization.set(''); authorizationSet.set(false); authorizationCleared.set(true)">Le retirer</button>
                  </span>
                }
              </div>
              <div class="tb-field">
                <label i18n class="tb-label" for="tb-ac-sign">Clé de signature (facultatif)</label>
                <tb-password inputId="tb-ac-sign" [(value)]="signingSecret" autocomplete="off" />
                @if (signingSecretSet()) {
                  <span class="tb-field-hint">
                    <ng-container i18n>Enregistrée.</ng-container>
                    <button i18n type="button" class="tb-link-btn" (click)="signingSecret.set(''); signingSecretSet.set(false); signingSecretCleared.set(true)">La retirer</button>
                  </span>
                } @else {
                  <span i18n class="tb-field-hint">En-tête X-ThermoBox-Signature : sha256=HMAC du corps.</span>
                }
              </div>
            </div>
          }
        }

        <div class="tb-field">
          <label class="tb-choice">
            <input type="checkbox" [checked]="custom()" (change)="custom.set($any($event.target).checked)" />
            <span i18n>Message personnalisé</span>
          </label>
          @if (custom()) {
            <textarea id="tb-ac-template" class="tb-input tb-textarea" rows="5" maxlength="4000" i18n-aria-label aria-label="Message personnalisé"
                      [placeholder]="templateExample"
                      [value]="template()" (input)="template.set($any($event.target).value)"></textarea>
            <span class="tb-field-hint tb-alert-fields">
              <ng-container i18n>Remplace le message par défaut. Valeurs :</ng-container>
              @for (f of fields; track f) {
                <code>{{ f }}</code>
              }
            </span>
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
export class TbAlertChannelSheet {
  private readonly alerts = inject(AlertStore);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly kinds: { id: AlertChannelKind; label: string }[] = [
    { id: 'EMAIL', label: $localize`E-mail` },
    { id: 'WEBHOOK', label: $localize`Webhook` },
  ];
  protected readonly securities: { id: SmtpSecurity; label: string }[] = [
    { id: 'STARTTLS', label: $localize`STARTTLS (port 587)` },
    { id: 'SSL', label: $localize`SSL / TLS (port 465)` },
    { id: 'NONE', label: $localize`Aucun (réseau de confiance seulement)` },
  ];
  protected readonly formats: { id: WebhookFormat; label: string }[] = [
    { id: 'DISCORD', label: 'Discord' },
    { id: 'SLACK', label: $localize`Slack, Mattermost, Rocket.Chat, Teams` },
    { id: 'GENERIC', label: $localize`Générique (JSON)` },
  ];
  protected readonly fields = TEMPLATE_FIELDS;
  protected readonly templateExample = $localize`{type} : {room} ({place}) à {temperature}, consigne {setpoint}`;

  protected readonly shown = signal(false);
  protected readonly channel = signal<AlertChannel | null>(null);
  protected readonly creation = computed(() => this.channel() == null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);

  protected readonly name = signal('');
  protected readonly kind = signal<AlertChannelKind>('EMAIL');
  // Email
  protected readonly host = signal('');
  protected readonly port = signal<number | null>(587);
  protected readonly security = signal<SmtpSecurity>('STARTTLS');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly passwordSet = signal(false);
  protected readonly passwordCleared = signal(false);
  protected readonly from = signal('');
  protected readonly fromName = signal('');
  protected readonly recipients = signal('');
  // Webhook
  protected readonly format = signal<WebhookFormat>('DISCORD');
  protected readonly url = signal('');
  protected readonly urlSet = signal(false);
  protected readonly urlPreview = signal<string | null>(null);
  protected readonly authorization = signal('');
  protected readonly authorizationSet = signal(false);
  protected readonly authorizationCleared = signal(false);
  protected readonly signingSecret = signal('');
  protected readonly signingSecretSet = signal(false);
  protected readonly signingSecretCleared = signal(false);
  // Both
  protected readonly custom = signal(false);
  protected readonly template = signal('');

  protected readonly formatHint = computed(
    () =>
      ({
        DISCORD: $localize`Un message avec un encadré coloré. Discord › Paramètres du salon › Intégrations › Webhooks.`,
        SLACK: $localize`Un message texte ({"text": …}), compris aussi par Mattermost, Rocket.Chat et Teams.`,
        GENERIC: $localize`Toute l'alerte en JSON, pour n'importe quel service (n8n, Home Assistant…).`,
      })[this.format()],
  );

  private readonly recipientList = computed(() => [...new Set(this.recipients().split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]);

  protected readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return $localize`Nom obligatoire`;
    return n.length > 100 ? $localize`100 caractères au plus` : null;
  });
  protected readonly hostError = computed(() => {
    const h = this.host().trim();
    if (!h) return $localize`Serveur SMTP obligatoire`;
    return /[\s/]/.test(h) || h.length > 255 ? $localize`Un nom ou une adresse, sans « / »` : null;
  });
  protected readonly portError = computed(() => {
    const p = this.port();
    return p == null || p < 1 || p > 65535 ? $localize`De 1 à 65535` : null;
  });
  protected readonly fromError = computed(() => (EMAIL.test(this.from().trim()) ? null : $localize`Adresse e-mail invalide`));
  protected readonly recipientsError = computed(() => {
    const l = this.recipientList();
    if (!l.length) return $localize`Au moins une adresse`;
    if (l.length > 50) return $localize`50 adresses au plus`;
    const bad = l.find((m) => !EMAIL.test(m));
    return bad ? $localize`Adresse invalide : ${bad}` : null;
  });
  protected readonly urlError = computed(() => {
    const u = this.url().trim();
    if (!u) return this.urlSet() ? null : $localize`Adresse obligatoire`;
    try {
      const p = new URL(u);
      return /^https?:$/.test(p.protocol) ? null : $localize`Une adresse https://…`;
    } catch {
      return $localize`Adresse invalide`;
    }
  });
  private readonly invalid = computed(() =>
    this.kind() === 'EMAIL'
      ? !!(this.nameError() || this.hostError() || this.portError() || this.fromError() || this.recipientsError())
      : !!(this.nameError() || this.urlError()),
  );

  create(): void {
    this.fill(null);
  }

  edit(c: AlertChannel): void {
    this.fill(c);
  }

  private fill(c: AlertChannel | null): void {
    const e = c?.email;
    const w = c?.webhook;
    this.channel.set(c);
    this.name.set(c?.name ?? '');
    this.kind.set(c?.kind ?? 'EMAIL');
    this.host.set(e?.host ?? '');
    this.port.set(e?.port ?? 587);
    this.security.set(e?.security ?? 'STARTTLS');
    this.username.set(e?.username ?? '');
    this.password.set('');
    this.passwordSet.set(!!e?.passwordSet && !c?.secretUnreadable);
    this.passwordCleared.set(false);
    this.from.set(e?.from ?? '');
    this.fromName.set(e?.fromName ?? '');
    this.recipients.set((e?.recipients ?? []).join('\n'));
    this.format.set(w?.format ?? 'DISCORD');
    this.url.set('');
    this.urlSet.set(!!w?.urlSet && !c?.secretUnreadable);
    this.urlPreview.set(w?.urlPreview ?? null);
    this.authorization.set('');
    this.authorizationSet.set(!!w?.authorizationSet && !c?.secretUnreadable);
    this.authorizationCleared.set(false);
    this.signingSecret.set('');
    this.signingSecretSet.set(!!w?.signingSecretSet && !c?.secretUnreadable);
    this.signingSecretCleared.set(false);
    const t = e?.template ?? w?.template ?? '';
    this.template.set(t);
    this.custom.set(!!t);
    this.submitted.set(false);
    this.shown.set(true);
  }

  protected int(v: string): number | null {
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  /** The port follows the encryption, unless one of its own was typed. */
  protected setSecurity(s: SmtpSecurity): void {
    if (this.port() == null || Object.values(PORTS).includes(this.port()!)) this.port.set(PORTS[s]);
    this.security.set(s);
  }

  protected clearPassword(): void {
    this.password.set('');
    this.passwordSet.set(false);
    this.passwordCleared.set(true);
  }

  /** A secret: typed → sent; removed → ""; else left out (the server keeps it). */
  private secret(typed: string, cleared: boolean): string | undefined {
    if (typed) return typed;
    return cleared ? '' : undefined;
  }

  private request(): AlertChannelRequest {
    const template = this.custom() && this.template().trim() ? this.template() : '';
    const base = { name: this.name().trim(), kind: this.kind(), enabled: this.channel()?.enabled ?? true };
    if (this.kind() === 'EMAIL') {
      return {
        ...base,
        email: {
          host: this.host().trim(),
          port: this.port()!,
          security: this.security(),
          username: this.username().trim(),
          password: this.secret(this.password(), this.passwordCleared()),
          from: this.from().trim(),
          fromName: this.fromName().trim(),
          recipients: this.recipientList(),
          template,
        },
      };
    }
    return {
      ...base,
      webhook: {
        format: this.format(),
        url: this.url().trim() || undefined,
        authorization: this.secret(this.authorization(), this.authorizationCleared()),
        signingSecret: this.secret(this.signingSecret(), this.signingSecretCleared()),
        template,
      },
    };
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    this.submitted.set(true);
    if (this.invalid()) return;
    const c = this.channel();
    this.saving.set(true);
    try {
      const saved = c ? await this.alerts.updateChannel(c.id, this.request()) : await this.alerts.createChannel(this.request());
      this.toasts.info(c ? $localize`Canal « ${saved.name} » modifié` : $localize`Canal « ${saved.name} » créé`, c ? null : $localize`Touche « Tester » pour vérifier qu'il arrive.`);
      this.shown.set(false);
    } catch (err) {
      this.toasts.error($localize`Canal non enregistré`, explain(errorMessage(err)));
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeShown(): Promise<void> {
    const c = this.channel();
    if (c && (await this.remove(c))) this.shown.set(false);
  }

  /** Deletes [c] after a confirmation; true when done. */
  async remove(c: AlertChannel): Promise<boolean> {
    if (!(await this.confirm.ask($localize`Supprimer`, $localize`Supprimer le canal « ${c.name} » ? Il est retiré des règles qui le prévenaient.`, { confirm: $localize`Supprimer` }))) return false;
    try {
      await this.alerts.deleteChannel(c.id);
      this.toasts.info($localize`Canal « ${c.name} » supprimé`);
      return true;
    } catch (e) {
      this.toasts.error($localize`Suppression impossible`, errorMessage(e));
      return false;
    }
  }
}
