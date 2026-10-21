/** Lower case without accents, so « etage » finds « Étage ». */
export function normaliser(texte: string | null | undefined): string {
  return (texte ?? '').toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Every word of [recherche] is in [texte] (both normalised). */
export function correspond(texte: string, recherche: string): boolean {
  const mots = normaliser(recherche).split(/\s+/).filter(Boolean);
  const t = normaliser(texte);
  return mots.every((m) => t.includes(m));
}

/** First letter of a name, upper case (avatars). */
export function initiale(nom: string | null | undefined): string {
  return (nom ?? '').trim().charAt(0).toLocaleUpperCase('fr-FR');
}

/** Sort by name, ignoring case and accents. */
export function parNom<T>(nom: (x: T) => string | null | undefined): (a: T, b: T) => number {
  return (a, b) => normaliser(nom(a)).localeCompare(normaliser(nom(b)), 'fr');
}

/** « 1 salle », « 3 salles » */
export function pluriel(n: number, singulier: string, plurielMot = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielMot : singulier}`;
}
