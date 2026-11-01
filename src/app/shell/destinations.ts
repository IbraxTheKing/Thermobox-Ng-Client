import { AuthService } from '../core/auth';

export interface Destination {
  lien: string;
  icone: string;
  label: string;
  /** Also active on these pages (a salle belongs to « Salles »). */
  aussi?: string[];
  badge?: boolean;
}

/**
 * Places of the bar of phones before the last tab, as in native apps: four for a company
 * (« Plus » last); for a home, Maison and Historique, then « Réglages » with the rest.
 */
export function placesBarre(maison: boolean): number {
  return maison ? 2 : 4;
}

/** Pages of the navigation, for this user, in the words of the look (company or home). */
export function destinationsDe(auth: AuthService, maison = false): Destination[] {
  const d: Destination[] = maison
    ? [
        { lien: '/app/apercu', icone: 'pi-home', label: 'Maison', aussi: ['/app/salle/'] },
        { lien: '/app/mesures', icone: 'pi-chart-line', label: 'Historique' },
        { lien: '/app/salles', icone: 'pi-th-large', label: 'Pièces' },
      ]
    : [
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

/** Label and icon of the last tab of phones. */
export function dernierOnglet(maison: boolean, avecPlus: boolean): { label: string; icone: string; natif: string } {
  if (maison) return { label: 'Réglages', icone: 'pi-cog', natif: 'reglages' };
  return avecPlus ? { label: 'Plus', icone: 'pi-ellipsis-h', natif: 'plus' } : { label: 'Compte', icone: 'pi-user', natif: 'compte' };
}
