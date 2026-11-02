import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { DatePipe, NgTemplateOutlet, Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { KeyboardService } from '../../core/keyboard';
import { PlatformService } from '../../core/platform';
import { ThemeChoice, PreferencesService } from '../../core/preferences';
import { ServerFeaturesService } from '../../services/server-features.service';
import { TbSwitch } from '../../ui/controls';
import { DesktopService } from '../../core/desktop';
import { SeasonService } from '../../core/season';
import { NotificationService } from '../../core/notifications';
import { LANGUAGES, language, systemLanguage } from '../../core/i18n';
import { AccentService, DEFAULT_SWATCH, PALETTES, swatch } from '../../core/accent';
import { locale } from '../../core/i18n';
import { OnboardingService } from '../../core/onboarding';
import { TrPipe } from '../../ui/tr.pipe';
import { ToastService } from '../../core/messages';

/**
 * Preferences (preferences.xhtml): theme, colours following the state, unit, keyboard shortcuts
 * (kept on this device) and, for an ADMIN, the look of every client (the server itself: its
 * page, Serveur). Animations follow the system.
 */
@Component({
  selector: 'tb-preferences',
  imports: [TrPipe, TbSwitch, RouterLink, NgTemplateOutlet, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences.html',
})
export class PreferencesPage {
  protected readonly auth = inject(AuthService);
  protected readonly guide = inject(OnboardingService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly keyboard = inject(KeyboardService);
  protected readonly platform = inject(PlatformService);
  protected readonly accent = inject(AccentService);
  protected readonly features = inject(ServerFeaturesService);
  protected readonly desktop = inject(DesktopService);
  protected readonly seasons = inject(SeasonService);
  protected readonly notifications = inject(NotificationService);
  /** English, Français: each in its own words. */
  protected readonly languages = LANGUAGES;
  protected readonly systemLanguageName = LANGUAGES.find((l) => l.id === systemLanguage())!.name;
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /**
   * Outside the app (route data): from the login page, or the settings window of macOS. The
   * settings of this device only: no About, no server.
   */
  readonly standalone = input(false, { transform: booleanAttribute });
  /** « Réglages » on a Mac, as its apps name them; « Paramètres » from the login page (its button). */
  protected get heading(): string {
    return this.desktop.mac ? $localize`Réglages` : this.standalone() ? $localize`Paramètres` : $localize`Préférences`;
  }

  protected back(): void {
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/login');
  }

  protected readonly themes: { id: ThemeChoice; label: string; icon: string }[] = [
    { id: 'light', label: $localize`Clair`, icon: 'pi-sun' },
    { id: 'dark', label: $localize`Sombre`, icon: 'pi-moon' },
    { id: 'auto', label: $localize`Système`, icon: 'pi-mobile' },
  ];
  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  protected readonly palettes = PALETTES;
  protected readonly defaultSwatch = DEFAULT_SWATCH;
  protected readonly swatch = swatch;
  protected readonly accentName = computed(() => {
    const a = this.prefs.accent();
    if (a === 'system') return this.accent.systemAvailable() ? $localize`Système` : 'ThermoBox';
    return PALETTES.find((p) => p.id === a)?.label ?? 'ThermoBox';
  });
  /** Phones and tablets: no keyboard, no list. */
  protected readonly hasKeyboard = matchMedia('(hover: hover) and (pointer: fine)').matches;
  protected readonly platformName = this.desktop.active
    ? $localize`Application ${this.desktop.name()}`
    : { ios: 'iOS (Liquid Glass)', android: 'Android (Material 3)', web: 'Web (ThermoBox)' }[this.platform.platform];


  private readonly toasts = inject(ToastService);

  protected async testNotification(): Promise<void> {
    if (!(await this.notifications.test())) this.toasts.error($localize`Les notifications sont bloquées pour Thermobox dans les réglages du système.`);
  }

  protected toggleNotifications(on: boolean): void {
    if (on) void this.notifications.enable();
    else this.prefs.notifications.set(false);
  }

  /** « 1er décembre » */
  protected dayLabel(d: Date): string {
    if (language() !== 'fr') return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
    const n = d.getDate();
    return `${n === 1 ? '1er' : n} ${d.toLocaleDateString(locale(), { month: 'long' })}`;
  }
}
