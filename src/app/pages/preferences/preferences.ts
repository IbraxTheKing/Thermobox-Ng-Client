import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet, Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { KeyboardService } from '../../core/keyboard';
import { PlatformService } from '../../core/platform';
import { ThemeChoice, PreferencesService } from '../../core/preferences';
import { ServerFeaturesService } from '../../services/server-features.service';
import { TbSwitch } from '../../ui/controls';
import { DesktopService } from '../../core/desktop';
import { AccentService, DEFAULT_SWATCH, PALETTES, swatch } from '../../core/accent';

/**
 * Preferences (preferences.xhtml): theme, colours following the state, unit, keyboard shortcuts
 * (kept on this device) and, for an ADMIN, the look of every client (the server itself: its
 * page, Serveur). Animations follow the system.
 */
@Component({
  selector: 'tb-preferences',
  imports: [TbSwitch, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences.html',
})
export class PreferencesPage {
  protected readonly auth = inject(AuthService);
  protected readonly prefs = inject(PreferencesService);
  protected readonly keyboard = inject(KeyboardService);
  protected readonly platform = inject(PlatformService);
  protected readonly accent = inject(AccentService);
  protected readonly features = inject(ServerFeaturesService);
  protected readonly desktop = inject(DesktopService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /**
   * Outside the app (route data): from the login page, or the settings window of macOS. The
   * settings of this device only: no About, no server.
   */
  readonly standalone = input(false, { transform: booleanAttribute });
  /** « Réglages » on a Mac, as its apps name them; « Paramètres » from the login page (its button). */
  protected get heading(): string {
    return this.desktop.mac ? 'Réglages' : this.standalone() ? 'Paramètres' : 'Préférences';
  }

  protected back(): void {
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/login');
  }

  protected readonly themes: { id: ThemeChoice; label: string; icon: string }[] = [
    { id: 'light', label: 'Clair', icon: 'pi-sun' },
    { id: 'dark', label: 'Sombre', icon: 'pi-moon' },
    { id: 'auto', label: 'Système', icon: 'pi-mobile' },
  ];
  protected readonly panel = computed(() => this.prefs.style() === 'panel');
  protected readonly palettes = PALETTES;
  protected readonly defaultSwatch = DEFAULT_SWATCH;
  protected readonly swatch = swatch;
  protected readonly accentName = computed(() => {
    const a = this.prefs.accent();
    if (a === 'system') return this.accent.systemAvailable() ? 'Système' : 'ThermoBox';
    return PALETTES.find((p) => p.id === a)?.label ?? 'ThermoBox';
  });
  /** Phones and tablets: no keyboard, no list. */
  protected readonly hasKeyboard = matchMedia('(hover: hover) and (pointer: fine)').matches;
  /** The side bar of computers (the web on a wide screen). */
  protected readonly hasSidebar = this.platform.platform === 'web' && this.hasKeyboard;
  protected readonly platformName = this.desktop.active
    ? `Application ${this.desktop.name()}`
    : { ios: 'iOS (Liquid Glass)', android: 'Android (Material 3)', web: 'Web (ThermoBox)' }[this.platform.platform];

}
