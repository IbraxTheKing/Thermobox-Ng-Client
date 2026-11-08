//! The ThermoBox servers whose certificate the system does not know (a self-signed one, made by
//! the server itself): the user compares its SHA-256 fingerprint with the one the server printed
//! at startup, and trusts it; from then on that certificate, and only it, is accepted for that
//! host ("pinned"). A certificate the system knows (a public CA, or one installed on the machine,
//! as mkcert's) is accepted as usual.
//!
//! The calls to such a server go through [Tls::fetch] (reqwest with this verifier), not through
//! tauri-plugin-http, whose client only knows the public CAs and accepts nothing else.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error, RootCertStore, SignatureScheme};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

/// « AB:CD:… »: SHA-256 of a certificate, as the server prints it and browsers show it.
pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

#[derive(Default)]
struct Shared {
    /// Host → the fingerprint the user trusts.
    pins: RwLock<HashMap<String, String>>,
    /// Host → the fingerprint of the last certificate it presented (for the question to the user).
    seen: Mutex<HashMap<String, String>>,
}

#[derive(Debug)]
struct Verifier {
    inner: Arc<WebPkiServerVerifier>,
    provider: Arc<CryptoProvider>,
    shared: Arc<Shared>,
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Shared")
    }
}

impl ServerCertVerifier for Verifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        let host = server_name.to_str().to_lowercase();
        let fp = fingerprint(end_entity.as_ref());
        if let Ok(mut seen) = self.shared.seen.lock() {
            seen.insert(host.clone(), fp.clone());
        }
        match self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, now) {
            Ok(v) => Ok(v),
            Err(e) => {
                let pinned = self.shared.pins.read().map(|p| p.get(&host) == Some(&fp)).unwrap_or(false);
                // The certificate the user trusted: valid for this host whatever its names and
                // its issuer (it is the very same certificate)
                if pinned { Ok(ServerCertVerified::assertion()) } else { Err(e) }
            }
        }
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

/// What a probe of a server found.
#[derive(Debug, serde::Serialize)]
pub struct Probe {
    /// Its certificate is accepted (known to the system, or trusted by the user).
    pub trusted: bool,
    /// The fingerprint of the certificate it presented, when it was not accepted.
    pub fingerprint: Option<String>,
    pub host: String,
    pub error: Option<String>,
}

/// An answer of [Tls::fetch].
pub struct Answer {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// The client, made the first time a server needs it (it reads the CAs of the system).
#[derive(Default)]
pub struct Tls {
    client: std::sync::OnceLock<Result<reqwest::Client, String>>,
    shared: Arc<Shared>,
}

impl Tls {
    fn client(&self) -> Result<&reqwest::Client, String> {
        self.client.get_or_init(|| Self::build(self.shared.clone())).as_ref().map_err(|e| e.clone())
    }

    fn build(shared: Arc<Shared>) -> Result<reqwest::Client, String> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        // The public CAs, and those installed on the machine (an enterprise CA, mkcert's…)
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        for cert in rustls_native_certs::load_native_certs().certs {
            let _ = roots.add(cert);
        }
        let inner = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider.clone())
            .build()
            .map_err(|e| e.to_string())?;
        let verifier = Arc::new(Verifier { inner, provider: provider.clone(), shared });
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| e.to_string())?
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        reqwest::Client::builder()
            .use_preconfigured_tls(config)
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            // A redirect to another host would carry the token there: the page follows it itself
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())
    }

    /// The hosts and the fingerprints the user trusts (all of them: replaces those known).
    pub fn set_pins(&self, pins: HashMap<String, String>) {
        if let Ok(mut p) = self.shared.pins.write() {
            *p = pins.into_iter().map(|(h, f)| (h.to_lowercase(), f.to_uppercase())).collect();
        }
    }

    /// Asks [url] once: is its certificate accepted, and which is it.
    pub async fn probe(&self, url: &str) -> Probe {
        let host = reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_matches(['[', ']']).to_lowercase())).unwrap_or_default();
        let client = match self.client() {
            Ok(c) => c,
            Err(e) => return Probe { trusted: false, fingerprint: None, host, error: Some(e) },
        };
        match client.get(url).send().await {
            Ok(_) => Probe { trusted: true, fingerprint: None, host, error: None },
            Err(e) => {
                let fingerprint = self.shared.seen.lock().ok().and_then(|s| s.get(&host).cloned());
                Probe { trusted: false, fingerprint, host, error: Some(chain(&e)) }
            }
        }
    }

    pub async fn fetch(&self, url: &str, method: &str, headers: &[(String, String)], body: Option<Vec<u8>>) -> Result<Answer, String> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut request = self.client()?.request(method, url);
        for (k, v) in headers {
            request = request.header(k, v);
        }
        if let Some(b) = body {
            request = request.body(b);
        }
        let response = request.send().await.map_err(|e| chain(&e))?;
        let status = response.status();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
            .collect();
        let body = response.bytes().await.map_err(|e| chain(&e))?.to_vec();
        Ok(Answer { status: status.as_u16(), status_text: status.canonical_reason().unwrap_or("").to_string(), headers, body })
    }
}

/// The error and its causes: « error sending request: … invalid peer certificate: UnknownIssuer ».
fn chain(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        text.push_str(": ");
        text.push_str(&s.to_string());
        source = s.source();
    }
    text
}

// ------------------------------------------------------------------ commands

/// The fetch asked by the page: its address, method and headers (the body comes raw).
#[derive(serde::Deserialize)]
struct FetchMeta {
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
}

/// The servers the user trusted, host → fingerprint (all of them), at start and after a change.
#[tauri::command]
pub fn tls_pins(tls: tauri::State<'_, Tls>, pins: HashMap<String, String>) {
    tls.set_pins(pins);
}

/// Is the certificate of [url] accepted (by the system, or trusted), and which is it.
#[tauri::command]
pub async fn tls_probe(tls: tauri::State<'_, Tls>, url: String) -> Result<Probe, String> {
    Ok(tls.probe(&url).await)
}

/// A call to a server through [Tls] (a certificate the user trusted, or one only the system
 * knows). The body comes raw; the header x-tb-fetch is the JSON of [FetchMeta] in base64. The
 * answer, raw too: the length of its JSON (4 bytes, big-endian), the JSON {status, statusText,
 * headers}, then the body.
 */
#[tauri::command]
pub async fn tls_fetch(tls: tauri::State<'_, Tls>, request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    use base64::Engine;
    let raw = request.headers().get("x-tb-fetch").and_then(|v| v.to_str().ok()).ok_or("x-tb-fetch missing")?;
    let json = base64::engine::general_purpose::STANDARD.decode(raw).map_err(|e| e.to_string())?;
    let meta: FetchMeta = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) if !b.is_empty() => Some(b.clone()),
        _ => None,
    };
    let answer = tls.fetch(&meta.url, &meta.method, &meta.headers, body).await?;
    let head = serde_json::to_vec(&serde_json::json!({
        "status": answer.status,
        "statusText": answer.status_text,
        "headers": answer.headers,
    }))
    .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(4 + head.len() + answer.body.len());
    out.extend_from_slice(&(head.len() as u32).to_be_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&answer.body);
    Ok(tauri::ipc::Response::new(out))
}
