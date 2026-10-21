/**
 * Where the ThermoBox REST API is, by default.
 *
 * - apiWeb: the web app, served by the same host as the API or through `ng serve` (proxy.conf.json
 *   sends /api to http://localhost:8080).
 * - apiNatif: the iOS / Android app. Empty: the address is asked on the login page (each
 *   organisation runs its own ThermoBox). Put an address here to build an app for one server.
 *
 * Users can always change the address on the login page ("Serveur").
 */
export const environment = {
  apiWeb: '/api',
  apiNatif: '',
};
