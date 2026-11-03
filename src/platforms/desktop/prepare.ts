import { DesktopOs } from '../target';

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

  // Unreachable server: a TypeError as the fetch of a browser (« Le serveur ne répond pas »)
  function throughRust(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return rustFetch(input, init).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new TypeError(e instanceof Error ? e.message : String(e));
    });
  }
}
