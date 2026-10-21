/** Where a salle stands against its consigne; `ton` picks the colours (CSS class tb-ton-…). */
export interface EtatSalle {
  readonly cle: 'STABLE' | 'EN_CHAUFFE' | 'TROP_CHAUD' | 'INCONNU';
  readonly label: string;
  readonly ton: 'stable' | 'chauffe' | 'chaud' | 'inconnu';
  readonly singulier: string;
  readonly pluriel: string;
}

export const ETATS = {
  STABLE: { cle: 'STABLE', label: 'Stable', ton: 'stable', singulier: 'stable', pluriel: 'stables' },
  EN_CHAUFFE: { cle: 'EN_CHAUFFE', label: 'En chauffe', ton: 'chauffe', singulier: 'en chauffe', pluriel: 'en chauffe' },
  TROP_CHAUD: { cle: 'TROP_CHAUD', label: 'Trop chaud', ton: 'chaud', singulier: 'trop chaude', pluriel: 'trop chaudes' },
  INCONNU: { cle: 'INCONNU', label: 'Pas de données', ton: 'inconnu', singulier: 'sans données', pluriel: 'sans données' },
} as const satisfies Record<string, EtatSalle>;

/** In this order on the dashboard chips. */
export const ORDRE_ETATS: EtatSalle[] = [ETATS.STABLE, ETATS.EN_CHAUFFE, ETATS.TROP_CHAUD, ETATS.INCONNU];

/** Within half a degree of the consigne counts as reached. */
export const SEUIL_CIBLE = 0.5;

export function etatDe(moyenne: number | null | undefined, consigne: number | null | undefined): EtatSalle {
  if (moyenne == null || consigne == null) return ETATS.INCONNU;
  const ecart = moyenne - consigne;
  if (ecart <= -SEUIL_CIBLE) return ETATS.EN_CHAUFFE;
  if (ecart >= SEUIL_CIBLE) return ETATS.TROP_CHAUD;
  return ETATS.STABLE;
}

/** « 3 trop chaudes » */
export function compte(etat: EtatSalle, n: number): string {
  return `${n} ${n > 1 ? etat.pluriel : etat.singulier}`;
}

/** Off the consigne: what the « À traiter » / « Loin de la consigne » counters count. */
export function horsConsigne(etat: EtatSalle): boolean {
  return etat === ETATS.EN_CHAUFFE || etat === ETATS.TROP_CHAUD;
}
