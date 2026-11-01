import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Applications iOS et Android (Capacitor) : le même client, empaqueté.
 *   npm run build && npx cap add ios && npx cap add android   (une seule fois)
 *   npm run cap:sync      puis ouvrir dans Xcode / Android Studio : npx cap open ios|android
 * L'adresse du serveur ThermoBox est demandée à la connexion (src/environments/environment.ts).
 */
const config: CapacitorConfig = {
  appId: 'ax.ibr.thermobox',
  appName: 'Thermobox',
  webDir: 'dist/Thermobox-Ng-Client/browser',
  backgroundColor: '#bccde2',
  ios: {
    // The page draws under the status bar and the home indicator (env(safe-area-inset-*))
    contentInset: 'never',
  },
  android: {
    // ThermoBox servers on a local network often run plain http
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
