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

`npm run desktop` starts `ng serve` and the window loads it (http://localhost:4200): the first
start compiles the client, the window waits for it. Started any other way (`cargo run`, the `.exe`
of `src-tauri/target/debug`), a debug build loads that address too and shows « localhost a refusé
de se connecter » when `npm start` is not running. `npm run desktop:build` gives the app with the
client inside, which starts at once.

## What is different from the web

| | |
|---|---|
| Server calls | Through Rust (`tauri-plugin-http`, `src/app/core/desktop.ts`): no CORS, and an `http://` server of the local network works from the `tauri://` page of macOS and Linux. The images of the server (its logo) too. |
| Links | Other sites open in the browser of the system (`tauri-plugin-opener`). |
| Service worker | Off: the files are in the app. |
| Login page | Desktop app only (not the web): « Paramètres » (the settings of this device: theme, accent, unit, keyboard… without À propos) and « À propos », top right. |
| macOS | The settings are only in the menu bar: Thermobox › Réglages… (⌘,), in a window of their own; Thermobox › À propos de Thermobox. No settings button in the page. The page goes under the title bar, the traffic lights sit in the side bar. An Édition menu gives ⌘C / ⌘V / ⌘A. |
| Windows | No native title bar: the page draws the one of WinUI 3 (32 px, Segoe Fluent Icons buttons, close in red, dimmed when the window is in the background), already in `index.html` before the client has loaded (which tells `main.rs` at once, `page_ready`: the title bar of Windows comes back only if the page never loads, and goes away again when it does). On its left, as the TitleBar of WinUI 3: « Retour » and the button of the side bar. The pointer resting on « Agrandir » opens the snap layouts of Windows 11. The scroll bar is the one of WinUI, under the title bar. Windows 11 (22H2 and up): the window has the Acrylic backdrop of the system behind the side bar and the title bar, in the theme of the app (`window_theme`, which redraws it), tinted by the page in its colour (theme, accent palette, colour of the room shown); Windows 10: the Mica grey. The side bar is a NavigationView: open (280 px) or folded to its icons (48 px) by the button of the title bar, the pane gliding to its width; under 1200 px, the icons, and that button opens the pane over the page. The whole page takes the Fluent 2 look of Windows 11 (`src/styles/windows.css`: Segoe UI Variable, Mica greys, buttons, text boxes, ToggleSwitch), in both looks of ThermoBox, and its motion: a new page comes in as one block, dialogs as ContentDialog, menus as flyouts, curves of Fluent, nothing that lifts or bounces, the theme changes at once. The accent colour of Windows is offered in Préférences. |
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
