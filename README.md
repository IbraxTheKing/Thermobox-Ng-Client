# Thermobox — client Angular

Client mobile-first de **[ThermoBox](https://github.com/IbraxTheKing/ThermoBox)** (surveillance des
températures par bâtiment, étage et salle) : le client JSF du serveur, refait en Angular et branché sur
son API REST. Une seule application pour le web, la PWA et les applications iOS / Android.

- Angular 22 : composants autonomes, sans zone.js, signals, `OnPush`, routes chargées à la demande
- PWA (service worker, manifeste, icônes) **et** applications natives avec Capacitor 8
- Une interface ThermoBox dont la « coque » (barre d'onglets, barre du haut, feuilles, notifications)
  prend le style de la plateforme, détecté automatiquement :
  - **iOS** : Liquid Glass (barre d'onglets en capsule de verre, lentille qu'on peut tenir et faire
    glisser, barre qui rétrécit au défilement)
  - **Android** : Material 3 (barre de navigation avec indicateur pilule, top app bar, snackbars, ondes)
  - **Web / ordinateur** : le rail et la barre du client JSF

  Pour tester une autre plateforme : `?plateforme=ios|android|web` dans l'adresse (`?plateforme=auto`
  pour revenir à la détection).

## Fonctionnalités

- **Aperçu** : une carte par salle (température, état, courbe des dernières 24 h, consigne), favoris,
  filtres par état, bâtiment et recherche ; la page prend la couleur de l'état choisi
- **Salle** : la carte de l'aperçu se transforme en page de la salle ; consigne, photo, historique
  (courbe avec bande de lecture sous le doigt et plein écran sur téléphone), consignes de la période
- **Salles** : arbre des bâtiments, étages, salles et boîtiers (glisser-déposer pour ranger)
- **Mesures** : courbes de toutes les salles ou de tous les bâtiments, tableau, export CSV
- **Gestion** (gestionnaires et administrateurs) : consignes en masse ; création, déplacement, accès ;
  utilisateurs et groupes. Sur téléphone : une liste, une feuille d'actions par élément, un mode sélection
- **Utilisateurs**, **Mises à jour** du serveur (administrateurs), **Profil**, **Préférences**
  (thème clair / sombre / système, unité, couleurs selon l'état, raccourcis clavier)
- **À propos** : versions du client, du serveur et de l'interface JSF ; versions du client publiées sur
  GitHub ; code source et crédits
- **Mouvement** : transitions entre les pages, cartes qui glissent quand un filtre ou un favori les
  déplace, retour en arrière en faisant glisser la page vers la droite (téléphones). Tout s'arrête quand
  l'appareil demande de réduire les animations (réglage du système, il n'y a pas de réglage dans l'app)

## Prérequis

- Node ≥ 22.22.3 (ou 24) et npm
- Le serveur ThermoBox, branche `dev` (les routes REST du client y sont depuis la PR #52)

## Démarrer

```bash
npm install
npm run demo        # API de démonstration en mémoire sur :8080 + ng serve (proxy /api)
```

Comptes de démonstration : `admin / admin1234`, `gestion / gestion1234`, `lecteur / lecteur1234`
(ce dernier ne voit que le bâtiment A).

Contre un vrai serveur : lancer ThermoBox sur `:8080`, puis `npm start` (`proxy.conf.json` envoie `/api`).

## Versions

Le client suit **la même numérotation que le serveur ThermoBox** : `AA.MM.PATCH`, éventuellement suivie
d'une prépublication.

| Version            | Ce que c'est                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `26.11.0`          | stable, première version de la série de novembre 2026                        |
| `26.11.1`          | correctif de la série (mise à jour **corrective**, compatible)               |
| `26.12.0`          | série suivante (mise à jour **fonctionnelle**)                               |
| `26.12.0-beta.1`   | beta de la série suivante, puis `-rc.1`…                                     |
| `26.12.0-nightly.3`| construite chaque nuit depuis la branche `dev`                               |

**La version vient de GitHub, pas de `package.json`** (qui reste à `0.0.0`) : `npm run build`
(`scripts/construire.mjs`) inscrit dans le client

1. `THERMOBOX_VERSION` si elle est définie (workflows GitHub, argument Docker),
2. sinon le tag Git posé sur le commit construit,
3. sinon `dev`,

ainsi que le commit construit. `ng serve` et `ng build` seuls donnent `dev`.

La page **À propos** affiche cette version et interroge les releases GitHub du dépôt : elle signale une
version plus récente (stable, ou aussi les prépublications quand le client en est une), corrective ou
fonctionnelle selon la série, comme le système de mise à jour du serveur.

### Publier (GitHub Actions)

Mêmes workflows que le serveur (`.github/workflows`) :

- **Release assets** (`release.yml`) : publier une release à la main sur GitHub (tag `26.11.0`…)
  joint `thermobox-ng-client-<version>.zip`, le client construit depuis ce tag avec sa version inscrite
- **Beta / RC** (`prerelease.yml`) : lancé à la main (onglet Actions) ; numérote la prochaine série
  (`26.12.0-beta.N`, `-rc.N`) d'après la dernière stable, construit la branche choisie, crée la pre-release
- **Nightly** (`nightly.yml`) : chaque nuit, construit `dev/<série>`, sinon `dev`, et publie
  `<série>.0-nightly.N` s'il y a de nouveaux commits. Le cron ne lit que le fichier présent sur la branche
  par défaut (`main`)

## Production

```bash
npm run build       # dist/Thermobox-Ng-Client/browser (avec service worker)
```

Servir ce dossier derrière le même hôte que l'API (`/api`), ou modifier `src/environments/environment.ts`.
Le service worker ne met jamais `/api` en cache.

### Docker

```bash
docker compose up -d --build                                    # http://localhost:2767
docker build --build-arg THERMOBOX_VERSION=26.11.0 -t thermobox-ng-client .
```

L'image sert le client avec Nginx et relaie `/api` vers `API_UPSTREAM`
(`http://host.docker.internal:8080` dans `compose.yaml`). `THERMOBOX_VERSION` (argument de construction) fixe la version
inscrite ; sans lui, c'est `dev` (le dossier `.git` n'est pas dans l'image).

## Applications iOS / Android (Capacitor)

```bash
npm run build
npx cap add ios && npx cap add android   # une seule fois (Xcode / Android Studio)
npm run cap:sync
npx cap open ios                         # ou android
```

Dans l'application native, l'adresse du serveur est demandée sur l'écran de connexion. La version de
l'application installée (celle des stores) est indiquée à part dans **À propos** ; elle se règle dans les
projets Xcode et Android Studio.

## Structure

```
scripts/          construire.mjs : build avec la version inscrite
src/app/core      session, HTTP, préférences, plateforme, transitions et animations, versions, unités…
src/app/services  accès à l'API REST
src/app/ui        feuilles, notifications, interrupteurs, graphique, arbre d'accès…
src/app/shell     coque : navigation adaptée à la plateforme, onglet « Plus »
src/app/pages     connexion, aperçu, salles, salle, mesures, gestion, utilisateurs, mises à jour,
                  profil, préférences, plus, à propos
src/styles        jetons et styles repris du JSF, couches iOS / Android, téléphone, mouvement
mock/             serveur REST de démonstration
nginx/, Dockerfile, compose.yaml   image de production
.github/workflows release, beta / rc, nightly
```

## Crédits

ThermoBox est conçu et développé par [ib · IbraxTheKing](https://github.com/IbraxTheKing).
Ce client utilise Angular, Capacitor, Chart.js, PrimeIcons, la police Manrope (SIL Open Font License) et
Tailwind CSS. Le serveur et l'interface JSF sont dans le dépôt
[ThermoBox](https://github.com/IbraxTheKing/ThermoBox) (licence MIT).
