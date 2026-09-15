# Thermobox NG Client

Client web Angular pour **[Thermobox](https://github.com/IbraxTheKing/ThermoBox)** : supervision des salles, visualisation des relevés de température en temps réel et envoi de consignes vers les box connectées.

> Ce dépôt fait suite à un premier client HTML/JS statique (proof of concept). L'objectif ici est une version Angular structurée, maintenable et prête à évoluer avec le reste du projet.

## Fonctionnalités prévues

- Liste des salles avec température mesurée et consigne courante
- Historique des relevés sous forme de graphique (mesures vs. consignes) sur plusieurs plages de temps (1h / 24h / 7j)
- Envoi d'une nouvelle consigne pour une salle donnée
- Authentification (selon le mécanisme exposé par l'API Thermobox)

## Stack technique

- [Angular](https://angular.dev/)
- TypeScript
- API REST Thermobox (Jersey / Jakarta EE) comme backend

## Prérequis

- Node.js (LTS recommandé)
- Angular CLI (`npm install -g @angular/cli`)
- Une instance de l'API Thermobox accessible (locale ou distante)

## Installation

```bash
git clone <url-du-repo>
cd thermobox-ng-client
npm install
```

## Configuration

L'URL de l'API Thermobox doit être renseignée dans les fichiers d'environnement Angular :

```
src/environments/environment.ts
src/environments/environment.development.ts
```

```ts
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api'
};
```

## Lancer le projet en développement

```bash
ng serve
```

L'application est alors disponible sur `http://localhost:4200/`.

## Build de production

```bash
ng build
```

Les fichiers compilés sont générés dans `dist/`.

## Notes

- Le champ `date` des entités `Temperature`/`Consigne` côté API est un `java.time.LocalDateTime` (sans fuseau) sérialisé en JSON — en tenir compte lors du parsing côté client.
- Le backend doit autoriser les requêtes cross-origin (CORS) si l'API et ce client ne sont pas servis depuis la même origine.
