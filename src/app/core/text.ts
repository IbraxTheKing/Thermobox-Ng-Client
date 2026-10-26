/** Lower case without accents, so « etage » finds « Étage ». */
export function normalize(text: string | null | undefined): string {
  return (text ?? '').toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Every word of [recherche] is in [texte] (both normalised). */
export function matches(text: string, search: string): boolean {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  const t = normalize(text);
  return words.every((m) => t.includes(m));
}

/** First letter of a name, upper case (avatars). */
export function initial(name: string | null | undefined): string {
  return (name ?? '').trim().charAt(0).toLocaleUpperCase('fr-FR');
}

/** Sort by name, ignoring case and accents. */
export function byName<T>(name: (x: T) => string | null | undefined): (a: T, b: T) => number {
  return (a, b) => normalize(name(a)).localeCompare(normalize(name(b)), 'fr');
}

/** « 1 salle », « 3 salles » */
export function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralWord : singular}`;
}
