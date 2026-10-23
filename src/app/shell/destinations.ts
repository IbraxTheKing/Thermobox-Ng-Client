import { AuthService } from '../core/auth';

export interface Destination {
  lien: string;
  icone: string;
  label: string;
  /** Also active on these pages (a salle belongs to « Salles »). */
  aussi?: string[];
  badge?: boolean;
}

/** Places of the bar of phones before the last tab (« Plus » / « Compte »), as in native apps. */
export const DESTINATIONS_BARRE = 4;

/** Pages of the navigation, for this user. */
export function destinationsDe(auth: AuthService): Destination[] {
  const d: Destination[] = [
    { lien: '/app/apercu', icone: 'pi-th-large', label: 'Aperçu' },
    { lien: '/app/salles', icone: 'pi-building', label: 'Salles', aussi: ['/app/salle/'] },
    { lien: '/app/mesures', icone: 'pi-chart-line', label: 'Mesures' },
  ];
  if (auth.gestionnaire()) d.push({ lien: '/app/gestion', icone: 'pi-sliders-h', label: 'Gérer' });
  if (auth.admin()) {
    d.push({ lien: '/app/utilisateurs', icone: 'pi-users', label: 'Utilisateurs' });
    d.push({ lien: '/app/mises-a-jour', icone: 'pi-cloud-download', label: 'Mises à jour', badge: true });
  }
  return d;
}
