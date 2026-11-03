# Desktop app (Windows, macOS, Linux)

Each system is a platform of its own, built apart (`docs/platforms.md`): what the three share is in `src/platforms/desktop/`, each one's own in `src/platforms/windows/`, `macos/`, `linux/` (and `src-tauri/src/win.rs`, `menu.rs`, `linux.rs` for Rust).

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
| Server calls | Through Rust (`tauri-plugin-http`, `src/platforms/desktop/prepare.ts`): no CORS, and an `http://` server of the local network works from the `tauri://` page of macOS and Linux. The images of the server (its logo) too. |
| Links | Other sites open in the browser of the system (`tauri-plugin-opener`). |
| Service worker | Off: the files are in the app. |
| Window | At least 900 × 600: the layout of phones never shows. |
| Side bar | Préférences, then the account at the very bottom; « Se déconnecter » is in the menu of the account. |
| Login page | Desktop app only (not the web), bottom right: « Paramètres » (the settings of this device: theme, accent, unit, keyboard… without À propos) and « À propos »; the version of the app in the middle of the bottom. |
| macOS | The settings are only in the menu bar: Thermobox › Réglages… (⌘,), in a window of their own; Thermobox › À propos de Thermobox. No settings button in the page. The page goes under the title bar, the traffic lights sit in the side bar. An Édition menu gives ⌘C / ⌘V / ⌘A. |
| Windows | No native title bar: the page draws the one of WinUI 3 (32 px, Segoe Fluent Icons buttons, close in red, dimmed when the window is in the background), already in `index.html` before the client has loaded (which tells `main.rs` at once, `page_ready`: the title bar of Windows comes back only if the page never loads, and goes away again when it does). On its left, as the TitleBar of WinUI 3: « Retour » and the button of the side bar. The pointer resting on « Agrandir » opens the snap layouts of Windows 11. The scroll bar is the one of WinUI, under the title bar. Windows 11 (22H2 and up): the window has the Acrylic backdrop of the system behind the side bar and the title bar, in the theme of the app (`window_theme`, which redraws it), tinted by the page in its colour (theme, accent palette, colour of the room shown); Windows 10: the Mica grey. The side bar is a NavigationView: open (280 px) or folded to its icons (48 px) by the button of the title bar, the pane gliding to its width; under 1200 px, the icons, and that button opens the pane over the page. The whole page takes the Fluent 2 look of Windows 11 (`src/platforms/windows/windows.css`: Segoe UI Variable, Mica greys, buttons, text boxes, ToggleSwitch, CheckBox; the tables as the lists of WinUI with their rows of 44 px; the filters as ToggleButtons, the bar of a selection as a CommandBar), in both looks of ThermoBox, and its motion: a new page comes in as one block, dialogs as ContentDialog, menus as flyouts, curves of Fluent, nothing that lifts or bounces, the theme changes at once. The accent colour of Windows is offered in Préférences. |
| Linux | The look of a GNOME app, GTK 4 / libadwaita (`src/platforms/linux/linux.css`), as the Windows app has the one of WinUI 3, over both looks of ThermoBox (its accent, its logo, the colours of the states and of the rooms stay, in the palette of GNOME: `src/platforms/linux/gnome-colors.ts`): Adwaita Sans, the greys of Adwaita (window, views, cards, sidebar), bold buttons with a veil of the text colour, pill buttons for the main actions, filled entries, the switch of GTK, toggle groups, boxed lists with their shade, dialogs as AdwDialog, toasts as pills at the bottom. The side bar is the sidebar of an AdwOverlaySplitView (as the GNOME apps, not as Windows): shown whole or hidden whole — never a strip of icons — by the « sidebar-show » button of the header bar; docked beside the page from 1200 px wide, over the page below (the button opens it); its rows those of a .navigation-sidebar (the page shown in a veil of the text), the account at its foot. The header bar is split as the one of a split view: over the docked sidebar, in its grey, the name of the app and the main menu (open-menu: a native menu of GTK with Préférences, Raccourcis clavier, the guide, À propos, Se déconnecter); over the page, the sidebar button, back (only when there is somewhere to go back to, a chevron), the name of the page, the main menu when the sidebar is hidden, the buttons of the window as GTK 4 draws them. The window is not transparent (`tauri.linux.conf.json`): square, its outline drawn by the page (a transparent window, for rounded corners, kept WebKitGTK drawing with the processor from painting the page but where something changed: under the pointer). No title bar of the desktop: the page draws the header bar of GNOME (46 px) in the colour of the page under it, « Retour » and the button of the side bar at the start, the name of the page in the middle, the round buttons of the window where the desktop puts them (`gtk-decoration-layout`, `decoration_layout` in `main.rs`, followed while the app runs: `linux-layout`; at the start, the close button of every dialog goes to the start too, before the search, html[data-buttons]); the whole bar moves the window (`data-tauri-drag-region="deep"`: its empty parts too), a double click maximizes. The accent colour of GNOME 47 and later (Settings › Appearance) is offered in Préférences (`system_accent`, gsettings). The light or dark style of GNOME (its color-scheme, also from the quick settings) is followed while the app runs (`watch_appearance` in `main.rs`: GTK 3 and WebKitGTK do not read it, it is given to GTK as its prefer-dark-theme, which the page sees as prefers-color-scheme), and a change of the accent reaches the page at once. Every dialog of the app is drawn as an AdwDialog: over the whole window, its header bar flat with the title in the middle and the small round close button. Why not GTK 4 itself: Tauri (tao and wry) is built on GTK 3 and WebKitGTK 4.1, there is no GTK 4 / WebKitGTK 6 version of it; the page takes its look. Between pages it moves as an AdwNavigationView (`src/platforms/linux/motion.ts`, driven by the events of the router), without view transitions (`src/platforms/linux/target.ts` takes them away: WebKitGTK drawing with the processor crashed on one, even skipped at once): a room, Préférences, the profile… slide in from the right over the page left, which moves a third of the way under a shade; back, the page leaves to the right; the pages of the sidebar replace each other with a short fade. The page scrolls with the wheel and the touchpad: the guard of pull to refresh (overscroll-behavior on the root, `motion.css`) is undone in `linux.css`, WebKitGTK no longer scrolled the root with it. No entrance of the page part by part, and the curves are drawn at once (their animation redrew the chart on every frame of the slide). Two fingers to the right on the touchpad go back (to the left when it does not scroll « naturally », `org.gnome.desktop.peripherals.touchpad`): the page follows the fingers and uncovers the page below, which is the real one (the app goes back as the gesture starts, under the copy of the page, and forward again if the gesture is given up); let go past the middle or flung, it goes back (Préférences › Fenêtre › Balayer pour revenir). Préférences › Fenêtre also chooses the window: « GNOME » (the look above, by default) or « GTK 3 », the window of the system decorated by GTK 3 with a real GtkHeaderBar (`src-tauri/src/linux.rs`): back, the sidebar button, the title of the page and the main menu are native widgets (its entries a native popover), the page tells what they show (`native_chrome`); the page fills the window, square, with the scroll bar of GTK 3 and buttons in the Adwaita of GTK 3. And the rendering: on the graphics card or on the processor (`WEBKIT_DISABLE_COMPOSITING_MODE`, set before WebKit starts); « Automatique » takes the processor without a real card (a virtual machine, WSL, no `/dev/dri/renderD*`), where the card emulated by the processor (llvmpipe) gave 4 to 25 frames a second, the processor itself about 40 to 60. Both choices are read at start from `linux.json` in the folder of the settings of the app, the app starts again to apply them; the window is hidden until set up (`tauri.linux.conf.json`). Préférences (and the « Paramètres » of the login page) open as an AdwPreferencesDialog over the page, as in Fichiers or Paramètres (`src/platforms/linux/adw-dialog.ts`; the guard of /app/preferences and /settings opens it instead of the page): search at the start of its header bar (also Ctrl+F, or typing), its title in the middle, the round close button; the groups with their bold title above their boxed list; Escape closes the search, then the dialog. À propos too, as an AdwAboutDialog (no title, the logo, the name and the version in an accent pill in the middle, then the lists). No « Retour » in the head of the pages: the back button of the header bar is there. The scroll bar of the window is hidden (WebKitGTK drew it over the header bar and past the rounded corner) and drawn as the overlay scroll bar of GTK 4, under the header bar (`src/platforms/linux/gtk-scrollbar.ts`): a thin line while the page scrolls or the pointer comes near the edge, wider under the pointer, dragged or clicked on its track. The colours of the states and of the rooms are those of the GNOME palette (blue, teal, green, yellow, orange, red), more saturated, on the neutral greys of Adwaita. |
| Theme | « Système » follows the system, also when it changes while the app is open: the window is then left on the theme of the system (`window_theme` with `null`), the webview sees `prefers-color-scheme` change. A theme picked by the user sets the window to it. |
| Right click | No menu of the webview (Reload, Inspect…). The elements of the app have native menus of the system (`src/app/core/context-menu.ts`, `src/platforms/desktop/menus.ts`, `[tbContextMenu]`): the cards of the rooms (Ouvrir, Aperçu rapide, favourite, Copier le nom), the rows of Gérer (page, consigne, boîtiers, Cocher, and for admins rename / access / delete), the users and groups of Accès, the tree of the rooms, the curves of Historique. A text field gets Couper / Copier / Coller / Tout sélectionner, a selected text Copier. On the web, the browser's menu. On Windows the menus are not the Win32 ones Tauri opens (squared, grey) but the MenuFlyout of WinUI 3, drawn by the page (`src/platforms/windows/flyout.ts`): Acrylic (opaque when Préférences › Flou is off), corners of 8 px, rows of 32 px, the shortcut on the right, the keyboard of WinUI (↑ ↓, first letter, Enter, Escape); « Coller » reads the clipboard through Rust (`clipboard_text`, WebView2 keeps it from the page). |
| Drop-down lists | Every `<select>` opens a native menu of the system under it, the option chosen ticked (click, Space, Enter, F4, Alt+↓; the arrows still change the option); on Windows the list of a ComboBox of WinUI 3, over the list, its choice marked by the accent bar. The filter of the groups of Accès too. |

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
