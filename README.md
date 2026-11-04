# Thermobox — Angular client

Mobile-first client of **[ThermoBox](https://github.com/IbraxTheKing/ThermoBox)** (temperature
monitoring per building, floor and room, at work or at home): the former JSF client of the server,
redone in Angular on top of its REST API. One client for the web and the PWA, the iOS and Android
apps, and the Windows, macOS and Linux apps.

- Angular 22: standalone components, no zone.js, signals, `OnPush`, lazy-loaded routes
- PWA (service worker, manifest, icons), iOS and Android apps with Capacitor 8, desktop apps with
  Tauri 2
- **One client, one build per platform** ([docs/platforms.md](docs/platforms.md)): the web client
  is shared, and each platform adds only its own code and styles (`src/platforms/<name>`). The
  Windows app holds nothing of the Linux one, the web nothing of the desktop apps.
- Each platform looks like its system, while staying ThermoBox (its accent, its logo, the colours
  of the states and of the rooms):

  | Platform | Look |
  | --- | --- |
  | Web, on a computer | the rail and the bar of the former JSF client |
  | Web on a phone, iOS app | Liquid Glass: glass capsule tab bar, a lens that can be held and slid, a bar that shrinks while scrolling |
  | Web on a phone, Android app | Material 3: navigation bar with pill indicator, top app bar, snackbars, ripples; native Material components in the app ([plugin](plugins/thermobox-native/README.md)) |
  | Windows | WinUI 3: its title bar, Acrylic, flyouts, motion |
  | macOS | native look: Liquid Glass on macOS 26, vibrancy on 11–15, unified toolbar, settings in the menu bar and their own window |
  | Linux | GNOME (GTK 4 / libadwaita): header bar, rounded window, dialogs, swipe back; or the window of GTK 3 |

  On the web, the look of a phone follows its system; `?platform=ios|android|web` in the address
  forces one (`?platform=auto` to go back to detection).
- Two styles of interface, chosen for a server by its administrator: « Maison » for homes (calm,
  the page in the colour of the room) and « Panneau de configuration » for professional sites.
- In English and in French, the language of the system by default ([docs/i18n.md](docs/i18n.md)).
  The texts are written in French in the code; the code, comments and docs are in English.

## Features

- **Overview**: a card per room (temperature, state, last 24 h curve, setpoint), favorites, filters
  by state, building and search; the page takes the colour of the chosen state
- **Room**: the card of the overview morphs into the room page; setpoint, photo, history (curve with
  a reading band under the finger and full screen on phones), setpoints of the period
- **Rooms**: tree of the buildings, floors, rooms and devices (drag and drop to arrange)
- **Measurements**: curves of every room or every building, table, CSV export
- **Management** (managers and administrators): setpoints in bulk; creation, moves, accesses; users
  and groups. On phones: a list, an action sheet per element, a selection mode
- **Accounts**: several accounts on the same device, on one or several ThermoBox servers (at home, at
  work…), listed per server with its logo (26.12 servers); switch from "Changer de compte" (More tab
  on phones, rail on computers) or from the login page. Registering happens on the server of one's
  choice
- **Users**, server **Updates** (administrators), **Profile**, **Preferences** (language, light /
  dark / system theme, accent colour, unit, colours following the state, keyboard shortcuts,
  setpoint notifications; on the desktop apps, the options of their window; for an administrator
  of a 26.12 server: its logo and the temperatures it accepts)
- **Seasonal looks** of the « Maison » style and **notifications** when a room leaves its setpoint
  ([docs/seasons-and-notifications.md](docs/seasons-and-notifications.md))
- **Accounts import**, provisional passwords and a guide for the first visit
  ([docs/accounts.md](docs/accounts.md))
- **About**: versions of the client and the server; client versions published on GitHub; source code
  and credits
- **Motion**: transitions between pages, cards that slide when a filter or a favorite moves them,
  going back by dragging the page to the right (phones). Everything stops when the device asks for
  reduced motion (system setting, there is no setting in the app)

## ThermoBox servers: API v1 and v2

The client talks to every ThermoBox server:

| Server            | API                                                                          |
| ----------------- | ---------------------------------------------------------------------------- |
| 26.12 and later   | **v2**, `/api/v2/…` in English (`/api/v2/hierarchy/tree`, `"BUILDING"`)     |
| 26.11             | v1, `/api/…` with French names (`/api/hierarchie/arbre`, `"BATIMENT"`), and `GET /api/server` |
| before 26.11      | v1 only                                                                      |

The services are written against v2. `GET /api/server` (public) tells which APIs a server answers
(`"apiVersions": ["v1", "v2"]` since 26.12; 404 before 26.11). For a v1 server,
`src/app/core/api-version.ts` rewrites each request to its v1 path and translates the JSON both ways,
as the server itself does for old clients (`LegacyApi.kt`). What only v2 has is offered only to v2
servers:

- the **server logo** (`/api/v2/server/logo`): next to the server in the account lists, as a badge
  on the avatar of an account, in the browser tab; an administrator changes it in Preferences;
- the **temperature limits** (`/api/v2/server/limits`): the dial and the steppers stay within the
  setpoints the server accepts; an administrator sets them in Preferences. Before 26.12: 5 to 35 °C,
  as before;
- no more mention of the JSF interface, which 26.12 no longer has.

The server is asked again at each login (it may have been updated since).

## Requirements

- Node ≥ 22.22.3 (or 24) and npm
- The ThermoBox server (any version with the REST routes of PR #52; 26.12 for v2)

## Getting started

```bash
npm install
npm run demo        # in-memory demo API on :8080 + ng serve (proxy /api)
```

Demo accounts: `admin / admin1234`, `gestion / gestion1234`, `lecteur / lecteur1234` (sees building
A only), `camille / camille1234`.

The demo server plays a 26.12 server by default; `--api v1` plays a 26.11 one, `--api old` an older
one (French API only), to try the client against each. `--seed huge` fills it like the server's
large data set (320 rooms, 960 devices, 500 accounts). Its options: [mock/README.md](mock/README.md).

Against a real server: start ThermoBox on `:8080`, then `npm start` (`proxy.conf.json` forwards
`/api`).

### Commands

| Command | What it does |
| --- | --- |
| `npm start` | `ng serve` of the web build on :4200 (`-- --configuration linux` for another platform) |
| `npm run demo` / `npm run mock` | the demo API with `ng serve` / alone |
| `npm run build` | the web build, with its version (`dist/Thermobox-Ng-Client/browser`) |
| `npm run build -- --target <platform>` | the build of one platform: `web`, `android`, `ios`, `windows`, `macos`, `linux` |
| `npm run build:android`, `npm run build:ios` | the builds of the mobile apps |
| `npm run cap:android`, `npm run cap:ios`, `npm run cap:sync` | build and copy into the Capacitor projects |
| `npm run desktop`, `npm run desktop:build` | the desktop app of this system: dev window / installers ([src-tauri](src-tauri/README.md)) |
| `npm run i18n` | gathers the texts of every platform into `src/locale/en.json` ([docs/i18n.md](docs/i18n.md)) |

## Large installations

On the overview, only the cards near the screen are drawn: blocks of a few rows far above or
below are replaced by empty boxes of their height, and drawn again when the page comes back to
them (the scroll and the page length do not move). Elsewhere, hundreds of rooms, devices or
accounts are drawn a part at a time: the room lists, the measurements table, the users and the
management lists show the first ones, then the next ones as the end of the page comes near (or
with « Afficher la suite »); a search looks through all of them. Only what is drawn costs anything: the 24 h curves of the overview cards, the
curves of the measurements page and the accesses of the users are read for the rows shown.

The curves ask the server for a few hundred points each (`?points=`, 26.12), picked among the
real measures; the raw history is read a page at a time (`?limit=&offset=`). The polls stop
while the page is hidden, and an unchanged tree does not redraw anything. The curves of the
overview are read for the cards drawn, at most every 150 ms while the page scrolls, and read again
after a failure.

## Versions

The client follows **the same numbering as the ThermoBox server**: `YY.MM.PATCH`, maybe followed by
a prerelease.

| Version            | What it is                                                                   |
| ------------------ | ---------------------------------------------------------------------------- |
| `26.11.0`          | stable, first version of the November 2026 series                            |
| `26.11.1`          | patch of the series (**patch** update, compatible)                           |
| `26.12.0`          | next series (**feature** update)                                             |
| `26.12.0-beta.1`   | beta of the next series, then `-rc.1`…                                       |
| `26.12.0-nightly.3`| built every night from the `dev` branch                                      |

**The version comes from GitHub, not from `package.json`** (which stays at `0.0.0`): `npm run build`
(`scripts/build.mjs`) writes into the client

1. `THERMOBOX_VERSION` when it is defined (GitHub workflows, Docker argument),
2. else the Git tag on the commit being built,
3. else `dev`,

and the commit being built. `ng serve` and `ng build` alone give `dev`.

The **About** page shows this version and reads the GitHub releases of the repository: it points out
a newer version (stable, or also the prereleases when the client is one), patch or feature depending
on the series, like the update system of the server.

### Publishing (GitHub Actions)

Same workflows as the server (`.github/workflows`):

- **Release assets** (`release.yml`): publishing a release by hand on GitHub (tag `26.11.0`…)
  attaches `thermobox-ng-client-<version>.zip`, the client built from that tag with its version
- **Beta / RC** (`prerelease.yml`): started by hand (Actions tab); numbers the next series
  (`26.12.0-beta.N`, `-rc.N`) from the last stable, builds the chosen branch, creates the pre-release
- **Nightly** (`nightly.yml`): every night, builds `dev/<series>`, else `dev`, and publishes
  `<series>.0-nightly.N` when there are new commits. The cron only reads the file on the default
  branch (`main`)
- **Desktop apps** (`desktop.yml`): the Windows, macOS and Linux apps, added to each of these
  releases (and built on each change of `src-tauri/`); see [docs/desktop.md](docs/desktop.md)

## Production

```bash
npm run build       # the web build: dist/Thermobox-Ng-Client/browser (with service worker)
```

Serve that folder behind the same host as the API (`/api`), or change
`src/environments/environment.ts`. The service worker never caches `/api`.

### Docker

```bash
docker compose up -d --build                                    # http://localhost:2767
docker build --build-arg THERMOBOX_VERSION=26.11.0 -t thermobox-ng-client .
```

The image serves the client with Nginx and forwards `/api` to `API_UPSTREAM`
(`http://host.docker.internal:8080` in `compose.yaml`). `THERMOBOX_VERSION` (build argument) sets the
version written; without it, it is `dev` (the `.git` folder is not in the image).

### From a release (`.zip`), without building anything

Each GitHub release has `thermobox-ng-client-<version>.zip`: the client already built, with its
version (`index.html` at the root). Serve it with Nginx and `nginx/default.conf.template`, which
forwards `/api` to the ThermoBox server:

```bash
mkdir thermobox-client && cd thermobox-client
gh release download 26.11.0-beta.1 -R IbraxTheKing/Thermobox-Ng-Client -p '*.zip'   # or from the release page
unzip thermobox-ng-client-26.11.0-beta.1.zip -d html
curl -LO https://raw.githubusercontent.com/IbraxTheKing/Thermobox-Ng-Client/dev/nginx/default.conf.template
```

```yaml
# compose.yaml, in that folder: docker compose up -d   →   http://localhost:2767
services:
  thermobox-ng-client:
    image: nginx:1.28-alpine
    ports: ["2767:80"]
    environment:
      API_UPSTREAM: http://host.docker.internal:8080
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./default.conf.template:/etc/nginx/templates/default.conf.template:ro
    restart: unless-stopped
```

- `API_UPSTREAM`: address of the REST server, **without** `/api` or a final `/` (Nginx keeps `/api`
  in the forwarded address). Server on the same machine: `http://host.docker.internal:8080`; server
  in a container of the same Docker network: its service name (`http://thermobox-rest:8080`), without
  `extra_hosts`.
- New version: empty `html/`, unzip the new archive there, `docker compose restart`. Browsers and the
  installed PWA take it at the next load (service worker).

## iOS / Android apps (Capacitor)

`android/` (and later `ios/`) is committed with the rest, on the same branches: they are source
projects. What is regenerated (copied client, `build/`, `local.properties`…) is ignored by their
`.gitignore`.

Each app is made from **its own build** of the client (`npm run build:android`,
`npm run build:ios`), not the web one: the web build has neither the native components of Android
nor what the iOS app does differently. `npm run cap:android` / `cap:ios` builds and copies in one
step. The build of the last platform is the one in `dist/`: build the web again before serving it.

### Android

In the Android app, the bottom navigation bar (a rail on tablets and phones held sideways), the main
action button of the pages, the notifications and the confirmations are **native Material 3
components** (local plugin `plugins/thermobox-native`: NavigationBarView, ExtendedFloatingActionButton,
Snackbar, MaterialAlertDialog) laid over the page, in the colours of the ThermoBox theme (light /
dark, tint of the state). The action menus (Rooms, Management) open as a native Material sheet.
Android back closes what is open, then goes back, then puts the app in the background; with the
gesture from the edge (predictive back, Android 14+), the page shrinks under the finger before going
back, and a room closes back into its card of the overview. Elsewhere (web, PWA, iOS), the page draws
everything itself.

If `android/capacitor.settings.gradle` does not mention `thermobox-native`, the plugin is not in the
app (`npm install` forgotten before `npx cap sync`): it then keeps the navigation of the page.

> 26.12: the plugin was renamed from `thermobox-natif` to `thermobox-native` (Java package
> `ax.ibr.thermobox.plugin`). After pulling: `npm install`, then `npx cap sync android`.

First time (Android Studio and a JDK 21):

```bash
npm install                      # also installs the local plugin ("file:" dependency)
npm run build:android            # the client of the Android app
npx cap add android              # creates android/
node scripts/android.mjs prepare # version and signing read from Gradle properties
npx cap sync android             # copies the client, registers the plugins (thermobox-native among them)
git add android && git commit -m "Android project"
```

Then, at each change: `npm run cap:android`, then `npx cap open android` (or `./gradlew` in
`android/`). `scripts/android.mjs prepare` changes nothing twice: the workflows run it again.

App version: `versionName` = the version of the client (`26.11.0-beta.1`), `versionCode` computed
from it, always growing (a stable comes after its prereleases):

```bash
node scripts/android.mjs version        # name=26.11.0-beta.1  code=261100401
cd android && ./gradlew assembleDebug -PthermoboxVersionName=26.11.0-beta.1 -PthermoboxVersionCode=261100401
```

The **Release assets**, **Beta / RC** and **Nightly** workflows attach the app to the release
(`.github/actions/android`, which makes the Android build after the web one is archived):

- with a signing key in the secrets of the repository: signed `thermobox-<version>.apk` and `.aab`
  (Play Store). Secrets: `ANDROID_KEYSTORE_BASE64` (the `.jks` in base64: `base64 -w0 thermobox.jks`),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`;
- without a key: `thermobox-<version>-debug.apk`, installable to try.

The key (`*.jks`, `*.keystore`) is never in the repository. The **Check** workflow builds the client
and the debug APK at each push on `main` and `dev` (APK kept a week in the artifacts).

### iOS

```bash
npm run build:ios && npx cap add ios     # once, on a Mac
npm run cap:ios && npx cap open ios      # then at each change: Xcode
```

In the native app, the address of the server is asked on the login screen. The version of the
installed app is shown separately in **About**.

## Desktop apps (Tauri)

```bash
npm run desktop          # the app of this system, reloaded on each change
npm run desktop:build    # its installers
```

What they do differently from the web, their builds and signing: [docs/desktop.md](docs/desktop.md);
their Rust side and the Linux options: [src-tauri/README.md](src-tauri/README.md).

## Structure

```
src/app/          the shared client: core, services, ui, shell, pages (src/app/README.md)
src/styles/       the shared stylesheets: tokens, controls, pages, shell, motion, themes, seasons
src/platforms/    what each platform adds: web, android, ios, native, desktop, windows, macos,
                  linux (src/platforms/README.md)
src/locale/       en.json: the English of every text
src-tauri/        desktop apps (Tauri 2, Rust): main.rs, win.rs, mac.rs and menu.rs (macOS), linux.rs
android/          the Android project (Capacitor)
plugins/          thermobox-native: native Material 3 components of the Android app
scripts/          build.mjs (build of a platform, with the version), version.mjs, android.mjs,
                  i18n.mjs
mock/             demo REST server (v1 and v2)
nginx/, Dockerfile, compose.yaml   production image
.github/          workflows (check, release, beta / rc, nightly, desktop, Docker), android action
docs/             the documents below
```

## Documentation

| Document | About |
| --- | --- |
| [docs/platforms.md](docs/platforms.md) | the platforms, their builds, how to add something for one of them |
| [docs/desktop.md](docs/desktop.md) | the Windows, macOS and Linux apps |
| [docs/i18n.md](docs/i18n.md) | the languages, how to write and translate a text |
| [docs/accounts.md](docs/accounts.md) | import of users, provisional passwords, guide of a first visit |
| [docs/seasons-and-notifications.md](docs/seasons-and-notifications.md) | seasonal looks, notifications of the setpoints |
| [docs/release-notes.md](docs/release-notes.md) | what the client reads in the notes of a GitHub release |
| [src/app/README.md](src/app/README.md) | the map of the shared client |
| [src/platforms/README.md](src/platforms/README.md) | the folders of the platforms |
| [src-tauri/README.md](src-tauri/README.md) | the Rust side of the desktop apps |
| [plugins/thermobox-native/README.md](plugins/thermobox-native/README.md) | the native plugin of the Android app |
| [mock/README.md](mock/README.md) | the demo server |

## Credits

ThermoBox is designed and developed by [ib · IbraxTheKing](https://github.com/IbraxTheKing).
This client uses Angular, Capacitor, Tauri, Chart.js, PrimeIcons, the Manrope font (SIL Open Font License)
and Tailwind CSS. The server is in the [ThermoBox](https://github.com/IbraxTheKing/ThermoBox)
repository (MIT license).
