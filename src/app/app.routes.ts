import { Routes } from '@angular/router';

import { adminGuard, loggedInGuard, managerGuard, publicGuard } from './core/http';

/**
 * Pages of the JSF interface, same order:
 * login / register → overview (dashboard) · rooms · room/:id · measurements · management (MANAGER,
 * ADMIN) · users, updates (ADMIN) · profile · preferences. The French addresses of earlier
 * versions (apercu, salles…) redirect to them.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'app/overview' },
  {
    path: 'login',
    title: 'Connexion',
    canActivate: [publicGuard],
    loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Inscription',
    canActivate: [publicGuard],
    loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterPage),
  },
  {
    path: 'app',
    canActivate: [loggedInGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', title: 'Aperçu', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'rooms', title: 'Bâtiments et salles', loadComponent: () => import('./pages/rooms/rooms').then((m) => m.RoomsPage) },
      { path: 'room/:id', title: 'Salle', loadComponent: () => import('./pages/room/room').then((m) => m.RoomPage) },
      { path: 'measurements', title: 'Températures', loadComponent: () => import('./pages/measurements/measurements').then((m) => m.MeasurementsPage) },
      {
        path: 'management',
        title: 'Gestion des salles',
        canActivate: [managerGuard],
        loadComponent: () => import('./pages/management/management').then((m) => m.ManagementPage),
      },
      {
        path: 'users',
        title: 'Utilisateurs',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/users/users').then((m) => m.UsersPage),
      },
      {
        path: 'updates',
        title: 'Mises à jour',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/updates/updates').then((m) => m.UpdatesPage),
      },
      { path: 'profile', title: 'Mon profil', loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfilePage) },
      { path: 'about', title: 'À propos', loadComponent: () => import('./pages/about/about').then((m) => m.AboutPage) },
      { path: 'more', title: 'Plus', loadComponent: () => import('./pages/more/more').then((m) => m.MorePage) },
      { path: 'preferences', title: 'Préférences', loadComponent: () => import('./pages/preferences/preferences').then((m) => m.PreferencesPage) },
    ],
  },
  // Addresses of the versions before 26.12 (bookmarks, shortcuts on a home screen)
  ...Object.entries({ apercu: 'overview', salles: 'rooms', mesures: 'measurements', gestion: 'management', utilisateurs: 'users', 'mises-a-jour': 'updates', profil: 'profile', 'a-propos': 'about', plus: 'more' }).map(
    ([old, path]) => ({ path: `app/${old}`, redirectTo: `app/${path}` }),
  ),
  { path: 'app/salle/:id', redirectTo: 'app/room/:id' },
  { path: '**', redirectTo: 'app/overview' },
];
