import catalog from './en.json';

/**
 * The English texts of the app (en.json: {id: {fr, en}}, kept up to date by `npm run i18n`).
 * Loaded by core/i18n.ts when the app is in English; a text without English stays in French.
 */
export const EN: Record<string, string> = Object.fromEntries(
  Object.entries(catalog as Record<string, { fr: string; en: string }>)
    .filter(([, t]) => t.en)
    .map(([id, t]) => [id, t.en]),
);
