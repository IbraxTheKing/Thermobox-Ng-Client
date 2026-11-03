import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

import { pageDialogGuard } from './core/page-dialogs';
import { adminGuard, loggedInGuard, managerGuard, passwordGuard, publicGuard } from './core/http';

/**
 * Pages of the JSF interface, same order:
 * login / register → overview (dashboard) · rooms · room/:id · measurements · management (MANAGER,
 * ADMIN) · users, server (ADMIN: resources, updates, settings) · profile · preferences. The French addresses of earlier
 * versions (apercu, salles…) redirect to them.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'app/overview' },
  {
    path: 'login',
    title: $localize`Connexion`,
    canActivate: [publicGuard],
    loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: $localize`Inscription`,
    canActivate: [publicGuard],
    loadComponent: () => import('./pages/auth/register').then((m) => m.RegisterPage),
  },
  // A provisional password (imported account, reset by an admin): the user chooses theirs first
  {
    path: 'password',
    title: $localize`Nouveau mot de passe`,
    canActivate: [passwordGuard],
    loadComponent: () => import('./pages/auth/password').then((m) => m.PasswordPage),
  },
  // Without an account (the buttons of the login page; the settings window of macOS): the
  // settings of this device, and À propos
  {
    path: 'settings',
    title: $localize`Paramètres`,
    data: { standalone: true },
    canActivate: [pageDialogGuard],
    loadComponent: () => import('./pages/preferences/preferences').then((m) => m.PreferencesPage),
  },
  {
    path: 'about',
    title: $localize`À propos`,
    data: { standalone: true },
    canActivate: [pageDialogGuard],
    loadComponent: () => import('./pages/about/about').then((m) => m.AboutPage),
  },
  {
    path: 'app',
    canActivate: [loggedInGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', title: $localize`Aperçu`, loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'rooms', title: $localize`Bâtiments et salles`, loadComponent: () => import('./pages/rooms/rooms').then((m) => m.RoomsPage) },
      { path: 'room/:id', title: $localize`Salle`, loadComponent: () => import('./pages/room/room').then((m) => m.RoomPage) },
      { path: 'measurements', title: $localize`Températures`, loadComponent: () => import('./pages/measurements/measurements').then((m) => m.MeasurementsPage) },
      {
        path: 'management',
        title: $localize`Gestion des salles`,
        canActivate: [managerGuard],
        loadComponent: () => import('./pages/management/management').then((m) => m.ManagementPage),
      },
      // The users are managed in Gérer › Utilisateurs et groupes
      { path: 'users', redirectTo: () => inject(Router).parseUrl('/app/management?tab=access') },
      {
        path: 'server',
        title: $localize`Serveur`,
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/server/server').then((m) => m.ServerPage),
      },
      // The updates are a tab of the Serveur page
      { path: 'updates', redirectTo: () => inject(Router).parseUrl('/app/server?tab=updates') },
      { path: 'profile', title: $localize`Mon profil`, loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfilePage) },
      { path: 'about', title: $localize`À propos`, canActivate: [pageDialogGuard], loadComponent: () => import('./pages/about/about').then((m) => m.AboutPage) },
      { path: 'more', title: $localize`Plus`, loadComponent: () => import('./pages/more/more').then((m) => m.MorePage) },
      { path: 'preferences', title: $localize`Préférences`, canActivate: [pageDialogGuard], loadComponent: () => import('./pages/preferences/preferences').then((m) => m.PreferencesPage) },
    ],
  },
  // Addresses of the versions before 26.12 (bookmarks, shortcuts on a home screen)
  ...Object.entries({ apercu: 'overview', salles: 'rooms', mesures: 'measurements', gestion: 'management', utilisateurs: 'users', 'mises-a-jour': 'server', profil: 'profile', 'a-propos': 'about', plus: 'more' }).map(
    ([old, path]) => ({ path: `app/${old}`, redirectTo: `app/${path}` }),
  ),
  { path: 'app/salle/:id', redirectTo: 'app/room/:id' },
  { path: '**', redirectTo: 'app/overview' },
];
