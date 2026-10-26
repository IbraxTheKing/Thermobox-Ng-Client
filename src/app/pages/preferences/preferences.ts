import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { KeyboardService } from '../../core/keyboard';
import { ToastService } from '../../core/messages';
import { PlatformService } from '../../core/platform';
import { ThemeChoice, PreferencesService } from '../../core/preferences';
import { ABSOLUTE_LIMITS, ServerFeaturesService } from '../../services/server-features.service';
import { SettingsService } from '../../services/settings.service';
import { UnitService, parseNumber } from '../../core/unit';
import { TemperatureLimits } from '../../models/models';
import { TbSwitch } from '../../ui/controls';

/**
 * Preferences (preferences.xhtml): theme, colours following the state, unit, keyboard shortcuts
 * (kept on this device) and, for an ADMIN, the look of every client and, on a 26.12 server, its
 * logo and the temperatures it accepts. Animations follow the system.
 */
@Component({
  selector: 'tb-preferences',
  imports: [TbSwitch, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences.html',
})
export class PreferencesPage {
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly keyboard = inject(KeyboardService);
  protected readonly platform = inject(PlatformService);
  private readonly settings = inject(SettingsService);
  private readonly toasts = inject(ToastService);
  protected readonly features = inject(ServerFeaturesService);
  protected readonly unit = inject(UnitService);

  protected readonly themes: { id: ThemeChoice; label: string; icon: string }[] = [
    { id: 'light', label: 'Clair', icon: 'pi-sun' },
    { id: 'dark', label: 'Sombre', icon: 'pi-moon' },
    { id: 'auto', label: 'Système', icon: 'pi-mobile' },
  ];
  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  protected readonly styleSaving = signal(false);
  /** Phones and tablets: no keyboard, no list. */
  protected readonly hasKeyboard = matchMedia('(hover: hover) and (pointer: fine)').matches;
  /** The side bar of computers (the web on a wide screen). */
  protected readonly hasSidebar = this.platform.platform === 'web' && this.hasKeyboard;
  protected readonly platformName = { ios: 'iOS (Liquid Glass)', android: 'Android (Material 3)', web: 'Web (ThermoBox)' }[this.platform.platform];

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

  /** Saves the control-panel look for every user. */
  protected async changeStyle(panel: boolean): Promise<void> {
    this.styleSaving.set(true);
    try {
      await firstValueFrom(this.settings.changeStyle(panel ? 'panel' : 'glass'));
      this.toasts.info(panel ? 'Style panneau de configuration pour tout le monde' : "Style d'origine pour tout le monde");
    } catch (e) {
      this.toasts.error('Réglage non enregistré', errorMessage(e));
    } finally {
      this.styleSaving.set(false);
    }
  }
}
