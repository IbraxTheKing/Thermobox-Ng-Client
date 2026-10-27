import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { ToastService } from '../../core/messages';
import { UnitService, parseNumber } from '../../core/unit';
import { TemperatureLimits } from '../../models/models';
import { ABSOLUTE_LIMITS, ServerFeaturesService } from '../../services/server-features.service';

/**
 * The settings of the server itself (ADMIN, 26.12): its logo, and the temperatures it accepts
 * (setpoints, measurements). A tab of the Serveur page.
 */
@Component({
  selector: 'tb-server-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tb-panel tb-pref-server">
    <div class="tb-prefs">
      <div class="tb-pref tb-pref-logo">
        <span class="tb-server-logo-preview">
          @if (features.logo(); as l) { <img [src]="l" alt="Logo du serveur" /> } @else { <i class="pi pi-server"></i> }
        </span>
        <div class="tb-pref-text">
          <strong>Logo</strong>
          <span class="tb-muted">{{ logoSource() }} Affiché à côté du serveur dans la liste des comptes de chacun.</span>
        </div>
        <div class="tb-pref-actions">
          <label class="tb-btn tb-tonal" [class.tb-disabled]="logoSaving()">
            <i class="pi pi-upload"></i>Changer
            <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml" hidden [disabled]="logoSaving()" (change)="changeLogo($event)" />
          </label>
          @if (features.info()?.logoSource === 'custom') {
            <button type="button" class="tb-btn tb-flat" [disabled]="logoSaving()" (click)="resetLogo()">Automatique</button>
          }
        </div>
      </div>
      <form class="tb-pref tb-pref-limits" (submit)="saveLimits($event)">
        <span class="tb-section-icon"><i class="pi pi-sliders-h"></i></span>
        <div class="tb-pref-text">
          <strong>Températures acceptées</strong>
          <span class="tb-muted">
            Une consigne hors de ces bornes est refusée ; une mesure hors bornes est prise pour une erreur de capteur et ignorée.
          </span>
          <div class="tb-limits">
            @for (l of limitRows; track l.key) {
              <fieldset class="tb-limits-row">
                <legend>{{ l.label }}</legend>
                <label>de <input class="tb-input" type="number" inputmode="decimal" step="0.5" [value]="limitValue(l.key, 'min')" (input)="setLimit(l.key, 'min', $event)" [attr.aria-label]="l.label + ' minimale'" /></label>
                <label>à <input class="tb-input" type="number" inputmode="decimal" step="0.5" [value]="limitValue(l.key, 'max')" (input)="setLimit(l.key, 'max', $event)" [attr.aria-label]="l.label + ' maximale'" /></label>
                <span class="tb-muted">{{ unit.symbol() }}</span>
              </fieldset>
            }
          </div>
          @if (limitsError(); as e) { <span class="tb-field-error">{{ e }}</span> }
          <div class="tb-limits-actions">
            <button type="submit" class="tb-btn" [disabled]="limitsSaving() || !limitsChanged()">Enregistrer</button>
            <button type="button" class="tb-btn tb-flat" [disabled]="limitsSaving()" (click)="resetLimits()">Valeurs par défaut</button>
          </div>
        </div>
      </form>
    </div>

    </section>
  `,
})
export class ServerSettings {
  protected readonly features = inject(ServerFeaturesService);
  protected readonly unit = inject(UnitService);
  private readonly toasts = inject(ToastService);

  protected readonly logoSaving = signal(false);
  protected readonly logoSource = computed(
    () => ({ custom: 'Choisi par un administrateur.', site: 'Celui du site du serveur.', default: 'Celui de ThermoBox.' })[this.features.info()?.logoSource ?? 'default'] ?? '',
  );

  protected readonly limitRows: { key: keyof TemperatureLimits; label: string }[] = [
    { key: 'setpoint', label: 'Consigne' },
    { key: 'measurement', label: 'Mesure' },
  ];
  /** Typed values (in the unit shown), until saved. */
  private readonly typed = signal<Partial<Record<`${keyof TemperatureLimits}.${'min' | 'max'}`, number | null>>>({});
  protected readonly limitsSaving = signal(false);
  protected readonly limitsError = signal<string | null>(null);
  protected readonly limitsChanged = computed(() => Object.keys(this.typed()).length > 0);

  protected limitValue(k: keyof TemperatureLimits, b: 'min' | 'max'): string {
    const t = this.typed()[`${k}.${b}`];
    if (t !== undefined) return t == null ? '' : String(t);
    const c = this.features.limits()?.[k][b];
    return c == null ? '' : String(Math.round(this.unit.fromCelsius(c) * 10) / 10);
  }

  protected setLimit(k: keyof TemperatureLimits, b: 'min' | 'max', e: Event): void {
    const v = parseNumber((e.target as HTMLInputElement).value);
    this.typed.update((t) => ({ ...t, [`${k}.${b}`]: v }));
    this.limitsError.set(null);
  }

  protected async saveLimits(e: Event): Promise<void> {
    e.preventDefault();
    const current = this.features.limits();
    if (!current) return;
    const limits = structuredClone(current);
    for (const [path, v] of Object.entries(this.typed())) {
      const [k, b] = path.split('.') as [keyof TemperatureLimits, 'min' | 'max'];
      if (v == null) return this.limitsError.set('Chaque borne doit être un nombre');
      limits[k][b] = this.unit.inputToCelsius(v);
    }
    for (const l of this.limitRows) {
      if (limits[l.key].min >= limits[l.key].max) return this.limitsError.set(`${l.label} : le minimum doit être plus bas que le maximum`);
      if (limits[l.key].min < ABSOLUTE_LIMITS.min || limits[l.key].max > ABSOLUTE_LIMITS.max)
        return this.limitsError.set(`Les bornes restent entre ${this.unit.withSymbol(ABSOLUTE_LIMITS.min)} et ${this.unit.withSymbol(ABSOLUTE_LIMITS.max)}`);
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

  protected async resetLimits(): Promise<void> {
    this.limitsSaving.set(true);
    try {
      await this.features.resetLimits();
      this.typed.set({});
      this.limitsError.set(null);
      this.toasts.info('Températures acceptées : valeurs par défaut');
    } catch (err) {
      this.toasts.error('Réglage non enregistré', errorMessage(err));
    } finally {
      this.limitsSaving.set(false);
    }
  }

  protected async changeLogo(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return this.toasts.error('Logo trop lourd', '5 Mo au plus');
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

  protected async resetLogo(): Promise<void> {
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
}
