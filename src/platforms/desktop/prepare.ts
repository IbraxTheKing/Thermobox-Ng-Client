import { DesktopOs } from '../target';
import { certificateError, failure, secure, startTls, throughTls, tlsFetch } from './tls';

/**
 * Before Angular starts, in every desktop app (the systems add their own: platforms/<system>/):
 * html[data-desktop] for the stylesheets, and the calls to a ThermoBox server:
 * - macOS and Linux: through Rust (tauri-plugin-http): the tauri:// page could not reach a server
 *   in plain http on the local network (mixed content). The page's own files stay with the
 *   webview.
 * - Windows ([direct]): the page is http://tauri.localhost, it calls the server itself, as the
 *   browser and the mobile apps do (the server answers CORS). Through tauri-plugin-http, every
 *   response came back in pieces of a few kilobytes, each one a request of WebView2 to Rust: the
 *   photos of the rooms made thousands of them, and WebView2 kept the memory of each (several GB,
 *   then out of memory). Only if the server can't be reached directly (an old server without
 *   CORS) do its calls go through Rust.
 */
export async function prepareTauri(os: DesktopOs, direct = false): Promise<void> {
  document.documentElement.dataset['desktop'] = os;
  const { fetch: rustFetch } = await import('@tauri-apps/plugin-http');
  await startTls();
  const own = window.fetch.bind(window);
  /** Servers the webview could not call itself (CORS), called through Rust. */
  const throughRustOnly = new Set<string>();
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let outside = false;
    try {
      const u = new URL(url, location.href);
      outside = /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch {
      /* not a URL: the page's */
    }
    if (!outside) return own(input, init);
    if (throughTls(new URL(url, location.href).origin)) return pinned(input, init, url);
    if (!direct) return throughRust(input, init);
    const origin = new URL(url, location.href).origin;
    if (throughRustOnly.has(origin)) return throughRust(input, init);
    return own(input, init).catch((e: unknown) => {
      if (!(e instanceof TypeError)) throw e;
      // Refused by the webview (no CORS) or unreachable: Rust tries; if it gets an answer, this
      // server is reached through Rust from now on
      return throughRust(input, init).then((r) => {
        throughRustOnly.add(origin);
        return r;
      });
    });
  };

  // Unreachable server: a TypeError as the fetch of a browser (« Le serveur ne répond pas »).
  // Refused for its certificate: the user may trust it (tls.ts), then the call is made again.
  function throughRust(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return rustFetch(input, init).catch(async (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (certificateError(e, url) && (await secure(url))) return tlsFetch(input, init);
      throw failure(e, url);
    });
  }

  // A server trusted before: its certificate may have changed since (renewed, or another server)
  function pinned(input: RequestInfo | URL, init: RequestInit | undefined, url: string): Promise<Response> {
    return tlsFetch(input, init).catch(async (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      if (certificateError(e, url) && (await secure(url))) return tlsFetch(input, init);
      throw failure(e, url);
    });
  }
}
