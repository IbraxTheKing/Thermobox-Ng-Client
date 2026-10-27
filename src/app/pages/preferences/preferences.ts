import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth';
import { KeyboardService } from '../../core/keyboard';
import { PlatformService } from '../../core/platform';
import { ThemeChoice, PreferencesService } from '../../core/preferences';
import { ServerFeaturesService } from '../../services/server-features.service';
import { TbSwitch } from '../../ui/controls';
import { AccentService, DEFAULT_SWATCH, PALETTES, swatch } from '../../core/accent';
import { TbStyleSetting } from '../server/style-setting';

/**
 * Preferences (preferences.xhtml): theme, colours following the state, unit, keyboard shortcuts
 * (kept on this device) and, for an ADMIN, the look of every client (the server itself: its
 * page, Serveur). Animations follow the system.
 */
@Component({
  selector: 'tb-preferences',
  imports: [TbSwitch, RouterLink, TbStyleSetting],
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
  protected readonly platformName = { ios: 'iOS (Liquid Glass)', android: 'Android (Material 3)', web: 'Web (ThermoBox)' }[this.platform.platform];

}
