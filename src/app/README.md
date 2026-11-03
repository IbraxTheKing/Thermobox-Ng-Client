# src/app: the shared client

The client every platform is built from: the web client. What one platform does differently is not
here but in `src/platforms/<name>` ([docs/platforms.md](../../docs/platforms.md)).

## Start

`src/main.ts` moves the data of older versions (`core/storage-migration.ts`), loads the language
(`core/i18n.ts`), then `src/bootstrap.ts` runs the `prepare()` of the platform and starts Angular
with `app.config.ts` (its providers, then the platform's) and `app.ts` (the root: the components of
the platform, the router, the toasts, the dialogs). `app.routes.ts` lists the pages, lazily loaded.

## Folders

| Folder | What it holds |
| --- | --- |
| `core/` | services and helpers of the whole app (below) |
| `services/` | the REST API of ThermoBox, one service or store per resource |
| `models/` | the types of the API (`models.ts`), in the names of API v2 |
| `ui/` | components used by several pages: sheets, controls, the dial, the chart, the access tree, the server logo, the onboarding guide… |
| `shell/` | the frame around the pages: the rail and the side bar of computers, the tab bar of phones, the « Plus » tab (`destinations.ts`: the pages it leads to) |
| `pages/` | one folder per page: `auth` (login, password, register), `dashboard` (the overview), `room`, `rooms`, `measurements`, `management`, `server`, `updates`, `profile`, `preferences`, `about`, `more` |

### core

| File | Role |
| --- | --- |
| `auth.ts` | the accounts of this device, the session, login and logout |
| `http.ts`, `api.config.ts` | the token on each request, the busy bar, the guards of the routes (logged in, manager, admin); the default server address |
| `api-version.ts` | servers with API v1 only: every request rewritten and its JSON translated |
| `preferences.ts` | Préférences: theme, unit, colours, keyboard… stored on the device |
| `accent.ts`, `colors.ts`, `state.ts` | the accent colour, the colours of the temperatures and of the states |
| `platform.ts` | the look of the web on a phone (iOS, Android) or a computer |
| `transitions.ts`, `animations.ts`, `flip.ts` | the motion between pages and inside them |
| `desktop.ts` | `DesktopService`: the window of a desktop app; the web's does nothing |
| `page-motion.ts`, `page-dialogs.ts`, `native-ui.ts` | what a platform may put in the place of the web's motion, pages and components |
| `context-menu.ts` | the menus of the system (`[tbContextMenu]`), when the platform has some |
| `messages.ts`, `notifications.ts` | the toasts; the notifications of the setpoints |
| `keyboard.ts` | the keyboard shortcuts of computers |
| `i18n.ts`, `unit.ts`, `dates.ts`, `text.ts` | languages, units, dates, search without accents |
| `curves.ts`, `curve-cache.ts` | the points of the curves, kept between pages |
| `version.ts`, `client-update.ts`, `update-notice.ts`, `release-notes.ts` | the versions of the client and of the server, the updates |
| `seasons.ts`, `season.ts`, `background.ts`, `title.ts` | the « Maison » style: holidays, the colour of a room, its words |
| `onboarding.ts`, `storage-migration.ts`, `window-color.ts`, `file.ts`, `markdown.ts`, `back-gesture.ts` | the guide of a first visit, older data, the theme colour of the browser, files, release notes, swipes |

## Conventions

- Standalone components, `OnPush`, signals, no zone.js; pages are lazy-loaded.
- The interface is written in French and translated (`i18n` in templates, `$localize` and `tr()`
  in code): [docs/i18n.md](../../docs/i18n.md). Code, comments and docs are in English.
- No test of which build it runs in: a shared service or token with the web's behaviour, that the
  platform replaces ([src/platforms/README.md](../platforms/README.md)).
- Styles: in the shared stylesheets of `src/styles` (tokens, controls, pages, shell, motion,
  themes), not in the components.
