# src/platforms

What each platform adds to the shared client (`src/app`, `src/styles`). A build holds the shared
client and **one** platform: the Windows app has none of the Linux files, the web none of the
desktop ones. The whole picture, and how to add something for one platform:
[docs/platforms.md](../../docs/platforms.md).

| Folder | Platform | What is in it |
| --- | --- | --- |
| `target.ts` | – | `PlatformTarget`: what the shared client asks of a platform |
| `current.ts` | – | the platform of the build (the web); `angular.json` replaces it by `current.<name>.ts` |
| `web/` | browsers, PWA | the stylesheet of the web (with the looks of iOS and Android for phones) |
| `android/` | Android app | Material 3 styles, the native components (`native.ts`, plugin `thermobox-native`) |
| `ios/` | iOS app | Liquid Glass styles, the accent colour of iOS |
| `native/` | both mobile apps | the styles they share |
| `desktop/` | the three desktop apps | Tauri: server calls through Rust, native menus, notifications, the window |
| `windows/` | Windows app | WinUI 3: title bar, flyouts, motion, Acrylic, its preferences, its `index.html` |
| `macos/` | macOS app | the window, the drag strip, the settings window |
| `linux/` | Linux app | GNOME: header bar, libadwaita dialogs, motion and swipe back, GTK scroll bar, its colours and preferences, its `index.html` |

Each platform folder has:

- `styles.css`: the entry stylesheet of its build, the shared stylesheets in their order with the
  platform's own right after the one they complete (`windows/pages.css` after `styles/pages.css`);
- `target.ts`: its `PlatformTarget` (its `prepare()`, providers, components, traits), the only
  door from the shared client to the platform.

Rules:

- The shared client never tests which platform it runs on: it asks a shared service or token
  (`DesktopService`, `PAGE_MOTION`, `PAGE_DIALOGS`, `SYSTEM_ACCENT`, `NativeUi`…) whose default is
  the web's, and the platform provides its own.
- A platform imports from the shared client, never from another platform (except `desktop/` for
  the three desktop apps, `native/` for the two mobile ones).
- A rule of a shared stylesheet for one platform only goes to that platform's folder.
