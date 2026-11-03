import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS and Android apps (Capacitor): the same client, packaged.
 *   npm run build:ios && npx cap add ios; npm run build:android && npx cap add android   (once)
 *   npm run cap:android / cap:ios (cap:sync: both): each its own build (src/platforms/android,
 *   src/platforms/ios), then open in Xcode / Android Studio: npx cap open ios|android
 * The address of the ThermoBox server is asked at login (src/environments/environment.ts).
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
