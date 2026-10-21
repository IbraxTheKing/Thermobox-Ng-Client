import { Routes } from '@angular/router';

import { adminGuard, connecteGuard, gestionnaireGuard, publicGuard } from './core/http';

/**
 * Pages of the JSF interface, same order:
 * login / register → aperçu (dashboard) · salles · salle/:id · mesures · gestion (GESTIONNAIRE,
 * ADMIN) · utilisateurs, mises à jour (ADMIN) · profil · préférences.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'app/apercu' },
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
    canActivate: [connecteGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'apercu' },
      { path: 'apercu', title: 'Aperçu', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage) },
      { path: 'salles', title: 'Bâtiments et salles', loadComponent: () => import('./pages/salles/salles').then((m) => m.SallesPage) },
      { path: 'salle/:id', title: 'Salle', loadComponent: () => import('./pages/salle/salle').then((m) => m.SallePage) },
      { path: 'mesures', title: 'Températures', loadComponent: () => import('./pages/mesures/mesures').then((m) => m.MesuresPage) },
      {
        path: 'gestion',
        title: 'Gestion des salles',
        canActivate: [gestionnaireGuard],
        loadComponent: () => import('./pages/gestion/gestion').then((m) => m.GestionPage),
      },
      {
        path: 'utilisateurs',
        title: 'Utilisateurs',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/utilisateurs/utilisateurs').then((m) => m.UtilisateursPage),
      },
      {
        path: 'mises-a-jour',
        title: 'Mises à jour',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/mises-a-jour/mises-a-jour').then((m) => m.MisesAJourPage),
      },
      { path: 'profil', title: 'Mon profil', loadComponent: () => import('./pages/profil/profil').then((m) => m.ProfilPage) },
      { path: 'plus', title: 'Plus', loadComponent: () => import('./pages/plus/plus').then((m) => m.PlusPage) },
      { path: 'preferences', title: 'Préférences', loadComponent: () => import('./pages/preferences/preferences').then((m) => m.PreferencesPage) },
    ],
  },
  { path: '**', redirectTo: 'app/apercu' },
];
