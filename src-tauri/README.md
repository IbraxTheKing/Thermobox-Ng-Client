# src-tauri: the desktop apps (Rust)

The Windows, macOS and Linux apps: the Angular client in a native window, with
[Tauri 2](https://tauri.app). What the apps look like and do: [docs/desktop.md](../docs/desktop.md);
their part of the client: `src/platforms/desktop`, `windows`, `macos`, `linux`
([docs/platforms.md](../docs/platforms.md)).

## Run and build

Prerequisites: Node 24, Rust stable; on Linux, WebKitGTK and GTK 3:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev patchelf
```

```bash
npm run desktop          # tauri dev: ng serve of this system's build + the window
npm run desktop:build    # the installers of this system, in src-tauri/target/release/bundle
```

Each system builds its own client (`tauri.<system>.conf.json`): `beforeDevCommand` serves
`npm start -- --configuration <system>`, `beforeBuildCommand` runs
`npm run build -- --target <system>`. A debug binary (`cargo build`, `target/debug`) loads
http://localhost:4200: start the serve first.

## Files

| File | What it holds |
| --- | --- |
| `tauri.conf.json` | shared: identifier, version (set from the tag by the workflows), bundle, the macOS settings window, `macOSPrivateApi` (the see-through window of macOS) |
| `tauri.windows.conf.json` | Windows: no title bar of the system, transparent window (Acrylic), its build |
| `tauri.macos.conf.json` | macOS: overlay title bar, transparent window, the traffic lights in the middle of the toolbar, its build |
| `tauri.linux.conf.json` | Linux: no decorations, opaque window hidden until set up, its build |
| `capabilities/` | what the page may call: the core of Tauri, HTTP, notifications, opening links |
| `src/main.rs` | the app: plugins, the commands the page calls, the start of each system |
| `src/win.rs` | Windows: Acrylic, the theme of the window, Snap Layouts |
| `src/mac.rs` | macOS: the material behind the window: Liquid Glass on macOS 26 and up (`tauri-plugin-liquid-glass`), the vibrancy of a side bar from macOS 11 to 15; the swipe of the trackpad between pages, the traffic lights measured, the About panel and the height of the settings window (AppKit through `objc2`) |
| `src/tls.rs` | the servers whose certificate the system does not know (self-signed): their calls through reqwest with a verifier that accepts the certificate the user trusted (its SHA-256 fingerprint), and the CAs installed on the machine |
| `src/menu.rs` | macOS: the menu bar (Réglages…, À propos…, the edit menu) in the language of the page |
| `src/linux.rs` | Linux: the options of Préférences › Fenêtre (`linux.json`), the rendering of WebKitGTK, the rounded corners, the GTK 3 header bar, the accent and the style of GNOME, the button layout and the touchpad |

## Commands (`main.rs`)

Called by the page with `invoke` (`src/platforms/desktop`, `windows`, `macos`, `linux`).

| Command | Systems | What it does |
| --- | --- | --- |
| `app_language` | all | the language of the page: menu bar of macOS, titles of the windows |
| `page_ready` | Windows, Linux | the page has drawn its title bar: the one of the system is not needed (it comes back if the page never does) |
| `system_accent` | Windows, Linux | the accent colour of the system |
| `window_theme` | all | light, dark or the system's for the window frame (and Acrylic on Windows) |
| `window_acrylic` | Windows | Acrylic on or off (Préférences › Flou) |
| `snap_layouts` | Windows | the Snap Layouts flyout over the maximize button of the page |
| `settings_window` | macOS | opens the settings window |
| `mac_style` | macOS | the material the window has (`glass`, `vibrancy`, or none), the version of macOS and where the traffic lights are: the look of the page (`html[data-mac]`, `html[data-backdrop]`), its toolbar centred on them |
| `settings_height` | macOS | the settings window takes the height of the tab shown, animated by AppKit |
| `about_panel` | macOS | the About panel of the system, with the credits the page wrote (versions, server, links) |
| `tls_probe` | all | is the certificate of a server accepted, and its SHA-256 fingerprint when it is not |
| `tls_pins` | all | the hosts and fingerprints the user trusts |
| `tls_fetch` | all | a call to such a server (raw body in, raw answer out) |
| `clipboard_text` | Windows | the text of the clipboard, for « Coller » in the menus drawn by the page |
| `decoration_layout` | Linux | where the desktop puts the window buttons (`gtk-decoration-layout`) |
| `linux_options`, `set_linux_options` | Linux | Préférences › Fenêtre: read; store and restart |
| `native_chrome` | Linux | what the GTK 3 header bar shows (title, back, menu) |

Events sent by Rust to the page: `tb-open` (« À propos de Thermobox » of the menu bar of macOS), `system-appearance` (the accent or the style of GNOME changed),
`linux-layout` (the window buttons moved), `linux-input` (natural scrolling changed), `tb-native`
(a button of the GTK 3 header bar). Between windows, the page itself sends `tb-preferences` (a
preference changed in the settings window of macOS).

## Linux: environment

Read once, at start (`linux::prepare`), before GTK and WebKit:

| Variable | Set by the app when | Why |
| --- | --- | --- |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | Rendu « Processeur », or « Automatique » without a real graphics card (VM, WSL) | the processor draws faster than an emulated card |

A variable the user set is kept as it is. The ones the app set are removed before it restarts
(Préférences › Fenêtre › Redémarrer), so the new choice applies.

`~/.config/ax.ibr.thermobox/linux.json` (written by Préférences):

```json
{ "window": "gnome", "rendering": "auto", "rounded": true }
```
