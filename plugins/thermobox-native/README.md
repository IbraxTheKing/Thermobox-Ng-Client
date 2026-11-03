# thermobox-native

A local Capacitor plugin of the Android app (`ThermoboxNative`): native **Material 3** components
laid over the page, in the colours of the ThermoBox theme. The page keeps everything else.
Its side in the client: `src/platforms/android/native.ts` (only in the Android build).

| Method | Component |
| --- | --- |
| `configureBar`, `selectTab`, `showBar` | the navigation: a bar at the bottom (BottomNavigationView), a rail on the left on tablets and phones held sideways (NavigationRailView); pill indicator, badges, haptic feedback |
| `configureFab`, `expandFab` | the main action of the page (ExtendedFloatingActionButton), shrunk to its icon while the page scrolls down |
| `snackbar` | a notification (Snackbar) |
| `confirm` | a confirmation (MaterialAlertDialog) |
| `menu` | the action menu of a sheet (BottomSheetDialog) |
| `enableBack` | Android back taken by the page, step by step (predictive back of Android 14+: the page shrinks under the finger) |
| `systemAccent` | the Material You colour of the wallpaper (Android 12+) |

Events: `tab` (`{ id, repeated }`), `fab`, `size` (room taken by the bar or the rail, CSS px),
`back` (`{ step: start | progress | cancel | commit, progress, edge, y }`).

## Installing

It is a `file:` dependency of the client: `npm install` installs it, `npx cap sync android` (or
`npm run cap:android`) registers it in `android/`. If `android/capacitor.settings.gradle` does not
mention `thermobox-native`, it is not in the app, and the page keeps its own navigation, buttons
and sheets.

Java: `android/src/main/java/ax/ibr/thermobox/plugin/ThermoboxNativePlugin.java` (package
`ax.ibr.thermobox.plugin`), its icons in `android/src/main/res/drawable`.
