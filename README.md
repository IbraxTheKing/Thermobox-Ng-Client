# Thermobox — client Angular

Client mobile-first de **ThermoBox** (surveillance des températures par bâtiment / étage / salle),
clone du client JSF du serveur, branché sur l'API REST de la branche `dev` du serveur
(+ les routes ajoutées sur `feature/api-client-mobile`, voir plus bas).

- Angular 22 (standalone, zoneless, signals, OnPush, routes lazy)
- PWA (service worker, manifeste, icônes) **et** applications natives via Capacitor 8
- Une seule interface ThermoBox, dont la « coque » (barre d'onglets, barre du haut, feuilles, toasts)
  s'adapte automatiquement à la plateforme :
  - **iOS** : Liquid Glass (barre d'onglets flottante en capsule, lentille qui glisse, compactage au défilement)
  - **Android** : Material 3 (navigation bar / rail avec indicateur pilule, top app bar, snackbars, ripple)
  - **Web / bureau** : le rail et la barre basse du client JSF
  Détection automatique (`src/app/core/plateforme.ts`) ; pour tester, `?plateforme=ios|android|web|auto`.

## Prérequis

- Node ≥ 22.22.3 (ou 24), npm
- Le serveur ThermoBox, branche `feature/api-client-mobile` (basée sur `dev`)

## Démarrer

```bash
npm install
npm run demo        # API de démonstration en mémoire sur :8080 + ng serve (proxy /api)
```

Comptes de démo : `admin / admin1234`, `gestion / gestion1234`, `lecteur / lecteur1234`.

Contre un vrai serveur : lancer ThermoBox sur `:8080` puis `npm start` (`proxy.conf.json` envoie `/api`).

## Production

```bash
npm run build       # dist/Thermobox-Ng-Client/browser (avec service worker)
```

Servir ce dossier derrière le même hôte que l'API (`/api`), ou modifier `src/environments/environment.ts`.
Le service worker ne met jamais `/api` en cache.

## Applications iOS / Android (Capacitor)

```bash
npm run build
npx cap add ios && npx cap add android   # une seule fois
npm run cap:sync
npx cap open ios                         # ou android
```

Dans l'application native, l'adresse du serveur est demandée sur l'écran de connexion.

## Routes serveur ajoutées (branche `feature/api-client-mobile`)

`api/hierarchie` (arbre, détail, création/modification/déplacement), `api/climat`
(historique, moyennes, consigne), `api/favoris`, `api/reglages`, image des salles
(`api/salles/{id}/image`), `POST api/temperatures/type/{type}`. Détail dans `RestServer/README.md` du serveur.

## Structure

```
src/app/core      session, HTTP, préférences, plateforme, unités, dates, courbes
src/app/services  accès REST
src/app/ui        feuilles, toasts, interrupteurs, graphiques, arbre d'accès…
src/app/shell     coque (navigation adaptative)
src/app/pages     login, aperçu, salles, salle, mesures, gestion, utilisateurs, mises à jour, profil, préférences
src/styles        jetons et styles portés du JSF + couches iOS / Android
mock/             serveur REST de démonstration
```
