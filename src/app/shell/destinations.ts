import { AuthService } from '../core/auth';

export interface Destination {
  link: string;
  icon: string;
  label: string;
  /** Also active on these pages (a room belongs to « Salles »). */
  also?: string[];
  badge?: boolean;
}

/**
 * Places of the bar of phones before the last tab, as in native apps: four for a company
 * (« Plus » last); for a home, Home and Historique, then « Réglages » with the rest.
 */
export function barSlots(home: boolean): number {
  return home ? 2 : 4;
}

/** Pages of the navigation, for this user, in the words of the look (company or home). */
export function destinationsOf(auth: AuthService, home = false): Destination[] {
  const d: Destination[] = home
    ? [
        { link: '/app/overview', icon: 'pi-home', label: 'Maison', also: ['/app/room/'] },
        { link: '/app/measurements', icon: 'pi-chart-line', label: 'Historique' },
        { link: '/app/rooms', icon: 'pi-th-large', label: 'Pièces' },
      ]
    : [
        { link: '/app/overview', icon: 'pi-th-large', label: 'Aperçu' },
        { link: '/app/rooms', icon: 'pi-building', label: 'Salles', also: ['/app/room/'] },
        { link: '/app/measurements', icon: 'pi-chart-line', label: 'Mesures' },
      ];
  if (auth.manager()) d.push({ link: '/app/management', icon: 'pi-sliders-h', label: 'Gérer' });
  if (auth.admin()) {
    d.push({ link: '/app/users', icon: 'pi-users', label: 'Utilisateurs' });
    // Its resources, its updates (the badge: a version is out), its settings
    d.push({ link: '/app/server', icon: 'pi-server', label: 'Serveur', badge: true });
  }
  return d;
}

/** Label and icon of the last tab of phones. */
export function lastTab(home: boolean, hasMore: boolean): { label: string; icon: string; native: string } {
  if (home) return { label: 'Réglages', icon: 'pi-cog', native: 'settings' };
  return hasMore ? { label: 'Plus', icon: 'pi-ellipsis-h', native: 'more' } : { label: 'Compte', icon: 'pi-user', native: 'account' };
}
