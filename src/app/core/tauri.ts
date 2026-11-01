/**
 * The desktop app (Tauri, src-tauri/): the same client in a native window of Windows, macOS or
 * Linux. Known before Angular starts (main.ts), from what Tauri puts in the page.
 */
export const TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type DesktopOs = 'macos' | 'windows' | 'linux';

/** The system of the desktop app, null in a browser and in the iOS / Android apps. */
export const DESKTOP_OS: DesktopOs | null = !TAURI
  ? null
  : /Mac/.test(navigator.userAgent)
    ? 'macos'
    : /Windows/.test(navigator.userAgent)
      ? 'windows'
      : 'linux';

const images = new Map<string, Promise<string>>();

/**
 * An image of a ThermoBox server for an <img src>, in the desktop app: fetched through Rust (as
 * the API calls, prepareDesktop), shown from memory. The tauri:// page of macOS and Linux would
 * not load an http:// image of the local network itself. Elsewhere, the address as it is.
 */
export function imageSource(url: string): Promise<string> {
  if (!TAURI || !/^https?:/i.test(url)) return Promise.resolve(url);
  let p = images.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => URL.createObjectURL(b));
    p.catch(() => images.delete(url));
    images.set(url, p);
  }
  return p;
}
