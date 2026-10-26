import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { KeyboardService } from '../../core/keyboard';
import { ToastService } from '../../core/messages';
import { PlatformService } from '../../core/platform';
import { ThemeChoice, PreferencesService } from '../../core/preferences';
import { SettingsService } from '../../services/settings.service';
import { TbSwitch } from '../../ui/controls';

/**
 * Preferences (preferences.xhtml): theme, colours following the state, unit, keyboard shortcuts
 * (kept on this device) and, for an ADMIN, the look of every client. Animations follow the system.
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
