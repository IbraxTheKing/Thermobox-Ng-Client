# Desktop app (Windows, macOS, Linux)

The same Angular client in a native window, with [Tauri 2](https://tauri.app) (`src-tauri/`).

## Develop

Prerequisites: Node 24, Rust (stable), and on Linux the WebKitGTK libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev patchelf
```

```bash
npm ci
npm run desktop          # tauri dev: ng serve + the native window, reloaded on each change
npm run desktop:build    # the installers of the current system, in src-tauri/target/release/bundle
```

The address of the ThermoBox server is asked on the login page, as in the mobile apps.

`npm run desktop` starts `ng serve` and the window loads it (http://localhost:4200). Started any
other way (`cargo run`, the `.exe` of `src-tauri/target/debug`), a debug build loads that address
too and shows « localhost a refusé de se connecter » when `npm start` is not running: use
`npm run desktop`, or `npm run desktop:build` for an app with the client inside.

## What is different from the web

| | |
|---|---|
| Server calls | Through Rust (`tauri-plugin-http`, `src/app/core/desktop.ts`): no CORS, and an `http://` server of the local network works from the `tauri://` page of macOS and Linux. The images of the server (its logo) too. |
| Links | Other sites open in the browser of the system (`tauri-plugin-opener`). |
| Service worker | Off: the files are in the app. |
| Login page | « Paramètres » (the settings of this device: theme, accent, unit, keyboard… without À propos) and « À propos », top right. |
| macOS | The settings are only in the menu bar: Thermobox › Réglages… (⌘,), in a window of their own; Thermobox › À propos de Thermobox. No settings button in the page. The page goes under the title bar, the traffic lights sit in the side bar. An Édition menu gives ⌘C / ⌘V / ⌘A. |
| Windows | The native title bar is removed once the page is loaded (a page that fails to load leaves a window that can still be moved and closed); the page draws the one of WinUI 3 (32 px, Segoe Fluent Icons buttons, close in red, dimmed when the window is in the background). The page scrolls under it, blurred. The pointer resting on « Agrandir » opens the snap layouts of Windows 11. The accent colour of Windows is offered in Préférences. |
| Linux | The title bar of the desktop. GTK 3 and WebKitGTK 4.1: Tauri has no GTK 4 version (Tauri 3 neither). |

The settings window of macOS loads `index.html?view=settings`; `main.ts` starts the client on its
`/settings` page. A preference changed there applies at once in the main window (`tb-preferences`
event, and the `storage` event).

## Builds (GitHub Actions)

`.github/workflows/desktop.yml`, also called by `nightly.yml` and `prerelease.yml`, and started by a
version published by hand: the files are added to the release.

| System | Files |
|---|---|
| macOS (Apple silicon and Intel) | `thermobox-<version>-macos-universal.dmg` |
| Windows x64 | `thermobox-<version>-windows-x64-setup.exe` (installs for the current user) |
| Linux x86_64 | `.deb`, `.rpm`, `.AppImage` |

Signing (optional secrets):

- macOS: `APPLE_CERTIFICATE` (Developer ID Application .p12 in base64), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`; with `APPLE_ID`, `APPLE_PASSWORD` (app-specific password) and
  `APPLE_TEAM_ID`, the app is notarized too. Without them, the app is signed ad hoc: the first time,
  right click › Ouvrir (or System Settings › Privacy & Security › Open anyway).
- Windows: not signed; SmartScreen asks to confirm the first time (« Informations complémentaires ›
  Exécuter quand même »).
