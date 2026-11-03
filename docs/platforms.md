# Platforms

One client, the web client, and for each platform what is its own. A build is made for one
platform: it holds the shared client and that platform only. The Windows app knows nothing of the
styles or the code of the Linux app, and the reverse; the web knows nothing of the desktop apps.

| Platform | What it is | Build |
| --- | --- | --- |
| `web` | the browsers (served by the server, the Docker image) | `npm run build` |
| `android` | the Android app (Capacitor) | `npm run build:android`, `npm run cap:android` |
| `ios` | the iOS app (Capacitor) | `npm run build:ios`, `npm run cap:ios` |
| `windows` | the Windows app (Tauri) | `npm run build -- --target windows` (by `tauri build` on Windows) |
| `macos` | the macOS app (Tauri) | `npm run build -- --target macos` (by `tauri build` on macOS) |
| `linux` | the Linux app (Tauri) | `npm run build -- --target linux` (by `tauri build` on Linux) |

`tauri dev` and `tauri build` run the build of their system (`src-tauri/tauri.<system>.conf.json`:
`beforeDevCommand`, `beforeBuildCommand`). `ng serve --configuration linux` serves a platform.

## Where things are

```
src/app/            the shared client: pages, services, components (the web)
src/styles/         the shared styles
src/platforms/
  target.ts         what the shared client asks of a platform (PlatformTarget)
  current.ts        the platform of the build: the web; replaced by current.<name>.ts
  web/              the web: its stylesheet (with the looks of iOS and Android, for phones)
  android/          Material 3: its styles, its native components (native.ts)
  ios/              Liquid Glass: its styles
  native/           what the two mobile apps share (styles)
  desktop/          what the three desktop apps share: Tauri, the menus, the calls to the server
  windows/          WinUI 3: title bar, flyouts, motion, Acrylic, its preferences, its index.html
  macos/            the window of macOS, the settings window
  linux/            GNOME: header bar, dialogs of libadwaita, motion and swipe, GTK 3 window,
                    its preferences, its colours, its index.html
src-tauri/src/      main.rs (shared), win.rs, menu.rs (macOS), linux.rs
```

Each of `src/app`, `src/platforms` and `src-tauri` has a README with the details of its files.

## How a build gets its platform

`angular.json` has one configuration per platform, added to `production` or `development`
(`npm run build -- --target linux` is `ng build --configuration production,linux`). It sets:

- `styles`: `src/platforms/<name>/styles.css`, the shared stylesheets in their order with the
  platform's own where they go in the cascade. A rule of a shared stylesheet that is only for one
  platform lives in `src/platforms/<name>/<same name>.css`, imported right after it
  (`windows/pages.css` after `styles/pages.css`): the cascade is the same as when it was inline.
- `fileReplacements`: `src/platforms/current.ts` by `current.<name>.ts`. The shared client
  imports `TARGET` from `platforms/current` and only from there: whatever is not reached from the
  platform's `target.ts` is not in the build.
- `index`: the Windows and Linux apps have their own page (their frame before the client loads).

## What a platform gives (`PlatformTarget`)

- `prepare()`: before Angular starts (the Tauri calls to the server, `data-desktop`, the menus…).
- `providers`: services in the place of the shared ones. The shared service is the web's and does
  nothing where the platform has something of its own:
  - `DesktopService` (the window of a desktop app: `desktop/desktop.service.ts`, completed by
    each system);
  - `PAGE_MOTION` (how the pages move: `windows/motion.ts`, `linux/motion.ts`);
  - `PAGE_DIALOGS` (pages opened as dialogs: `linux/adw-dialogs.ts`);
  - `SYSTEM_ACCENT` (the accent colour of the system);
  - `NativeUi`, `NativeBar` (native components of the Android app).
- `rootComponents`, `rootOverlays`: put in the app (the title bar of Windows, the header bar and
  the dialogs of GNOME, the drag strip of macOS).
- `appearanceRows`, `preferenceGroups`: put in Préférences (the blur of Windows, the window of
  Linux). They keep their settings apart (`windows/settings.ts`, `linux/settings.ts`).
- `traits`: facts the shared client follows (the settings in the menu bar on macOS, the side bar
  over the page on Windows and Linux, charts drawn at once…).

A menu of the system (`showMenu`, `[tbContextMenu]`) goes to the menus the platform installed
(`setMenuHost`): native menus on macOS and Linux, flyouts of WinUI on Windows, none on the web.

## Adding something for one platform

1. In the platform's folder: its component, its service, its stylesheet.
2. Reached from its `target.ts` (a provider, a root component, a row of Préférences, `prepare`).
3. If the shared client must call it, a shared token or service with the web's behaviour (none),
   that the platform replaces: never a test of the platform in the shared client.
