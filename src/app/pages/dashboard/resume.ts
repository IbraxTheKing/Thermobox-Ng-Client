import { Sparkline } from '../../core/courbes';
import { EtatSalle } from '../../core/etat';
import { Noeud } from '../../models/models';

/** A dashboard card: a salle and the average of its boxes (SalleResume of the JSF interface). */
export interface SalleResume {
  salle: Noeud;
  /** « Bâtiment A › Étage 1 » */
  chemin: string;
  batiment: Noeud | null;
  etat: EtatSalle;
  /** Moyenne − consigne, Celsius. */
  ecart: number | null;
  tendance: Sparkline | null | undefined;
}
