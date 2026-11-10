/**
 * The ThermoBox servers whose certificate the system does not know (a self-signed one, made by
 * the server itself since 26.12), in the desktop apps: the user compares the SHA-256 fingerprint
 * of the certificate with the one the server printed at startup, and trusts it once. Its calls
 * then go through Rust (tls.rs), which accepts that certificate, and only it, for that host. A
 * certificate the system knows but tauri-plugin-http does not (a CA installed on the machine, as
 * mkcert's) goes the same way, without a question.
 *
 * The page cannot do it itself: WebView2, WKWebView and WebKitGTK refuse such a certificate
 * without asking, and so does tauri-plugin-http.
 */

/** What the user is asked, and answers. */
export interface CertificateQuestion {
  /** The server, « thermobox.lan:8443 ». */
  host: string;
  /** SHA-256 of its certificate, « AB:CD:… ». */
  fingerprint: string;
  /** The fingerprint trusted before, when the certificate changed since. */
  previous: string | null;
}

const PINS = 'tb-tls-pins';
const ORIGINS = 'tb-tls-origins';

/** Host → fingerprint the user trusts. */
function readPins(): Record<string, string> {
  try {
    return (JSON.parse(localStorage.getItem(PINS) ?? '{}') as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

/** The origins whose calls go through Rust (tls.rs). */
function readOrigins(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ORIGINS) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let pins = readPins();
const origins = readOrigins();
/** Who asks the user (the app, once started); before it, nobody: refused. */
let asker: ((q: CertificateQuestion) => Promise<boolean>) | null = null;
/** One question per server at a time, whatever the number of calls waiting for it. */
const asking = new Map<string, Promise<boolean>>();

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: { headers: Record<string, string> }): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args, options);
}

function save(): void {
  try {
    localStorage.setItem(PINS, JSON.stringify(pins));
    localStorage.setItem(ORIGINS, JSON.stringify([...origins]));
  } catch {
    /* kept for this launch */
  }
}

/** At the start of the app: Rust learns the certificates trusted before. */
export async function startTls(): Promise<void> {
  if (Object.keys(pins).length) await invoke('tls_pins', { pins }).catch(() => undefined);
}

/** The app asks the user (TlsTrustService). */
export function askCertificatesWith(ask: (q: CertificateQuestion) => Promise<boolean>): void {
  asker = ask;
}

/** The servers trusted: host → fingerprint (Préférences, to forget them). */
export function trustedCertificates(): Record<string, string> {
  return { ...pins };
}

export async function forgetCertificate(host: string): Promise<void> {
  delete pins[host];
  save();
  await invoke('tls_pins', { pins }).catch(() => undefined);
}

/** The calls to [origin] go through Rust (a certificate trusted, or known to the system only). */
export function throughTls(origin: string): boolean {
  return origins.has(origin);
}

/**
 * A call that failed may have been refused for its certificate: any network error of an HTTPS
 * server. tauri-plugin-http only says « error sending request for url (…) », without the cause
 * (reqwest shows its causes apart): [secure] asks the server itself which it is.
 */
export function certificateError(e: unknown, url: string): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * [url] failed, maybe for its certificate: is it one the system knows (then its calls go through
 * Rust), or one to trust (the user is asked)? False when the server is not reached at all (no
 * certificate seen): the error stays. True when the call can be made again.
 */
export async function secure(url: string): Promise<boolean> {
  const u = new URL(url);
  if (u.protocol !== 'https:') return false;
  const key = u.origin;
  let p = asking.get(key);
  if (!p) {
    p = settle(u).finally(() => asking.delete(key));
    asking.set(key, p);
  }
  return p;
}

async function settle(u: URL): Promise<boolean> {
  const probe = await invoke<{ trusted: boolean; fingerprint: string | null; host: string; error: string | null }>('tls_probe', { url: u.origin + '/' }).catch(
    () => null,
  );
  if (!probe) return false;
  // Accepted by tls.rs (a CA installed on the machine, as mkcert's, which tauri-plugin-http does
  // not know, or a certificate trusted before): its calls go through it from now on
  if (!probe.trusted) {
    if (!probe.fingerprint || !asker) return false;
    const host = probe.host;
    const ok = await asker({ host: u.host, fingerprint: probe.fingerprint, previous: pins[host] && pins[host] !== probe.fingerprint ? pins[host] : null });
    if (!ok) return false;
    pins = { ...pins, [host]: probe.fingerprint };
    await invoke('tls_pins', { pins });
  }
  origins.add(u.origin);
  save();
  return true;
}

/** A call through Rust (tls.rs): as fetch, the whole answer at once. */
export async function tlsFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const headers: [string, string][] = [];
  request.headers.forEach((v, k) => headers.push([k, v]));
  const body = request.method === 'GET' || request.method === 'HEAD' ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
  const meta = new TextEncoder().encode(JSON.stringify({ url: request.url, method: request.method, headers }));
  const call = invoke<ArrayBuffer>('tls_fetch', body, { headers: { 'x-tb-fetch': base64(meta) } });
  const raw = await new Promise<ArrayBuffer>((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    call.then(resolve, (e: unknown) => reject(new TypeError(e instanceof Error ? e.message : String(e))));
  });
  const view = new DataView(raw);
  const length = view.getUint32(0);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 4, length))) as { status: number; statusText: string; headers: [string, string][] };
  const content = raw.slice(4 + length);
  const empty = [101, 204, 205, 304].includes(head.status) || request.method === 'HEAD';
  return new Response(empty ? null : content, { status: head.status, statusText: head.statusText, headers: head.headers });
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
