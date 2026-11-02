import { loadTranslations } from '@angular/localize';

/**
 * Languages of the app. The texts are written in French in the code (templates marked `i18n`,
 * `$localize` in TypeScript, `tr()` and the `tr` pipe for the texts inside expressions); English
 * is the main language: every system that is not in French gets English (src/locale/en.ts).
 *
 * The language is chosen before Angular starts (main.ts: [loadLanguage]): Préférences › Langue,
 * else the language of the system. Changing it reloads the app.
 */
export type Language = 'fr' | 'en';
export type LanguageChoice = Language | 'auto';

/** The languages offered, in their own words. */
export const LANGUAGES: readonly { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
];

let current: Language = 'fr';

const LOCALIZE = () => (globalThis as unknown as Record<string, (p: TemplateStringsArray) => string>)['$' + 'localize'];

/** The language of the app now. */
export function language(): Language {
  return current;
}

/** For Intl (numbers, dates): 24-hour clock and day first in English too. */
export function locale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-GB';
}

/** The language of the system: French if it is French, English otherwise. */
export function systemLanguage(): Language {
  const wanted = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  return wanted[0]?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** Préférences › Langue, as stored (PreferencesService writes it). */
export function storedChoice(): LanguageChoice {
  try {
    const l = (JSON.parse(localStorage.getItem('tb-preferences') ?? '{}') as { language?: LanguageChoice }).language;
    return l === 'fr' || l === 'en' ? l : 'auto';
  } catch {
    return 'auto';
  }
}

/** Before Angular starts: the language, and its texts when it is not French. */
export async function loadLanguage(): Promise<void> {
  const choice = storedChoice();
  current = choice === 'auto' ? systemLanguage() : choice;
  document.documentElement.lang = current;
  if (current === 'en') {
    const { EN } = await import('../../locale/en');
    loadTranslations(EN);
  }
}

/**
 * A text written in an expression (a ternary of a template, a message built in TypeScript), in
 * the language of the app: the same catalog as `$localize` (its id is computed from the French
 * text). {name} in the text is replaced by [params].name, after the translation.
 */
export function tr(text: string, params?: Record<string, string | number | null | undefined>): string {
  const parts = Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray;
  // Not written `$localize(…)`: the extraction of `ng extract-i18n` only takes tagged templates
  // (these texts are collected by scripts/i18n.mjs instead)
  let s = LOCALIZE()(parts);
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(v == null ? '' : String(v));
  return s;
}
