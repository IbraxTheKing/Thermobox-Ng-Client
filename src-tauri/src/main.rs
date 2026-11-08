// No console window behind the app on Windows (release builds)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Thermobox for Windows, macOS and Linux: the Angular client (../dist) in a native window.
//!
//! - macOS: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,) and open in a
//!   window of their own; « À propos de Thermobox » opens the page of the app. The title bar is
//!   the page's (traffic lights over it, tauri.macos.conf.json).
//! - Windows: no native title bar (tauri.windows.conf.json): the page draws one in the WinUI 3
//!   style (index.html at once, then Angular); its maximize button opens the snap layouts of
//!   Windows 11. The system's comes back if the page never says it is there ([PageReady]).
//!   Windows 11 (22H2 and up): the window has the Acrylic backdrop of the system (the side bar and
//!   the title bar are see-through, the page draws the rest), in the theme of the page
//!   ([window_theme]).
//! - Linux: no title bar of the desktop either (tauri.linux.conf.json): the page draws a header
//!   bar in the style of GNOME (libadwaita), its buttons where the desktop puts them
//!   ([decoration_layout]). GTK 3 / WebKitGTK 4.1: the toolkit of Tauri (it has no GTK 4 version).
//!   Or, as Préférences choose, the window of the system with a native header bar of GTK 3; the
//!   rendering on the processor where there is no graphics card (linux.rs).
//!
//! API calls go through tauri-plugin-http (see src/app/core/desktop.ts).

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod menu;
mod tls;
#[cfg(windows)]
mod win;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// The language of the app is French (else English, its main language): the system's at start,
/// then the one the page says ([app_language], Préférences › Langue).
static FRENCH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn french() -> bool {
    FRENCH.load(std::sync::atomic::Ordering::Relaxed)
}

/// The page tells its language ("fr", "en"): the menu bar of macOS and the titles of the windows
/// follow it.
#[tauri::command]
fn app_language(app: AppHandle, lang: String) {
    let fr = lang == "fr";
    if fr == french() {
        return;
    }
    FRENCH.store(fr, std::sync::atomic::Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    if let Ok(m) = menu::build(&app) {
        let _ = app.set_menu(m);
    }
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.set_title(if fr { "Réglages" } else { "Settings" });
    }
    let _ = app;
}

/// Label of the settings window (macOS).
const SETTINGS: &str = "settings";

/// Opens the settings window, or brings it to the front.
pub fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    // index.html?view=settings: main.ts starts the client on its /settings page
    let builder = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("index.html?view=settings".into()))
        .title(if french() { "Réglages" } else { "Settings" })
        .inner_size(600.0, 760.0)
        .min_inner_size(440.0, 480.0)
        .center()
        .focused(true);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .minimizable(false);
    builder.build()?;
    Ok(())
}

/// Asks the main window to open one of its pages (« about »).
pub fn open_page(app: &AppHandle, page: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    // To the main window only (not the settings window)
    let _ = app.emit_to("main", "tb-open", page);
}

#[tauri::command]
fn settings_window(app: AppHandle) -> Result<(), String> {
    open_settings(&app).map_err(|e| e.to_string())
}

/// Windows 11: the snap layouts, as when the pointer rests on the maximize button.
#[tauri::command]
fn snap_layouts(window: tauri::WebviewWindow) {
    let _ = window.set_focus();
    #[cfg(windows)]
    win::snap_layouts();
}

/// The accent colour of the system, #rrggbb: Windows (its registry), GNOME 47 and later (the
/// accent-color of org.gnome.desktop.interface, in the colours of libadwaita). Elsewhere the page
/// reads the CSS colour AccentColor itself (WebKit of macOS); null when there is none.
#[tauri::command]
fn system_accent() -> Option<String> {
    #[cfg(windows)]
    return win::accent();
    #[cfg(target_os = "linux")]
    return linux::gnome_accent();
    #[cfg(not(any(windows, target_os = "linux")))]
    None
}

/// The page has drawn its title bar (Windows and Linux, index.html): no need for the system's,
/// even if it came back meanwhile.
#[tauri::command]
fn page_ready(window: tauri::WebviewWindow, ready: tauri::State<'_, PageReady>) {
    ready.0.store(true, std::sync::atomic::Ordering::Relaxed);
    // (Linux, the window of the system chosen: it keeps its decorations, with the header bar)
    #[cfg(target_os = "linux")]
    if linux::native_window() {
        return;
    }
    #[cfg(any(windows, target_os = "linux"))]
    if window.label() == "main" && window.is_decorated().unwrap_or(false) {
        let _ = window.set_decorations(false);
    }
    let _ = window;
}

/// Windows: the text of the clipboard, for « Coller » in the menus drawn by the page (WebView2
/// keeps it from the page). Null elsewhere: macOS and Linux have native menus that paste.
#[tauri::command]
fn clipboard_text() -> Option<String> {
    #[cfg(windows)]
    return win::clipboard_text();
    #[cfg(not(windows))]
    None
}

/// Linux: where the desktop puts the buttons of the windows (GTK: gtk-decoration-layout, as
/// GNOME Tweaks sets it), « appmenu:minimize,maximize,close »: the header bar drawn by the page
/// puts its own at the same places. Null elsewhere or when GTK does not say.
#[tauri::command]
fn decoration_layout() -> Option<String> {
    #[cfg(target_os = "linux")]
    return linux::layout();
    #[cfg(not(target_os = "linux"))]
    None
}

/// Linux: the window and the rendering chosen in Préférences, and what the desktop says (linux.rs);
/// null elsewhere.
#[tauri::command]
fn linux_options() -> Option<serde_json::Value> {
    #[cfg(target_os = "linux")]
    return serde_json::to_value(linux::info()).ok();
    #[cfg(not(target_os = "linux"))]
    None
}

/// Linux: Préférences › Fenêtre, Rendu: stored, the app starts again with them.
#[tauri::command]
fn set_linux_options(app: AppHandle, window: String, rendering: String, rounded: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return linux::set_options(&app, window, rendering, rounded);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, window, rendering, rounded);
        Err("Linux only".into())
    }
}

/// Linux, the window of the system: what its native header bar shows (linux.rs).
#[tauri::command]
fn native_chrome(app: AppHandle, chrome: serde_json::Value) {
    #[cfg(target_os = "linux")]
    if let Ok(c) = serde_json::from_value(chrome) {
        linux::native_chrome(&app, c);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (app, chrome);
}

/// Windows 11: the Acrylic of the system behind the window, or not (Préférences › Flou). Answers
/// whether the window has it now: false where Windows can't draw it (Windows 10, other systems),
/// the page then paints itself.
#[tauri::command]
fn window_acrylic(window: tauri::WebviewWindow, on: bool, backdrop: tauri::State<'_, Backdrop>) -> bool {
    use std::sync::atomic::Ordering::Relaxed;
    if !backdrop.supported.load(Relaxed) {
        return false;
    }
    #[cfg(windows)]
    let shown = win::acrylic(&window, on);
    #[cfg(not(windows))]
    let shown = {
        let _ = (&window, on);
        false
    };
    backdrop.on.store(shown, Relaxed);
    shown
}

/// The theme of the page for the window: [theme] "light" or "dark" when the user picked one,
/// null when the app follows the system (Préférences › Thème › Système): the window and the
/// webview then follow it too, and the page sees the system change (prefers-color-scheme). A
/// theme forced here would hide the changes of the system from the page. [dark]: the theme shown
/// (the colours Windows draws around the window, the tint of its Acrylic, which does not take a
/// new theme by itself: it is put back).
#[tauri::command]
fn window_theme(window: tauri::WebviewWindow, theme: Option<String>, dark: bool, backdrop: tauri::State<'_, Backdrop>) {
    let forced = match theme.as_deref() {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        _ => None,
    };
    // Linux: set_theme(None) puts GTK back to light, whatever the style of GNOME: the style of
    // GNOME is given instead (linux.rs)
    #[cfg(target_os = "linux")]
    linux::window_theme(&window, theme.as_deref(), forced);
    #[cfg(not(target_os = "linux"))]
    let _ = window.set_theme(forced);
    #[cfg(windows)]
    win::window_theme(&window, dark, backdrop.on.load(std::sync::atomic::Ordering::Relaxed));
    let _ = (dark, backdrop);
}

/// The Acrylic of the window ([window_acrylic]): Windows can draw it (set at start), it is shown.
#[derive(Default)]
struct Backdrop {
    supported: std::sync::atomic::AtomicBool,
    on: std::sync::atomic::AtomicBool,
}

/// Set by [page_ready]. Windows: a page that never comes (its files out of reach, a debug build
/// started without `ng serve`) would leave a window without any title bar, impossible to move or
/// close: after a while, the title bar of Windows comes back.
#[derive(Default)]
struct PageReady(std::sync::atomic::AtomicBool);

fn main() {
    // Linux: the rendering of WebKitGTK is chosen before it starts
    #[cfg(target_os = "linux")]
    linux::prepare();
    FRENCH.store(
        sys_locale::get_locale().is_some_and(|l| l.to_lowercase().starts_with("fr")),
        std::sync::atomic::Ordering::Relaxed,
    );
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PageReady::default())
        .manage(tls::Tls::default())
        .manage(Backdrop::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                // Acrylic: the DWM backdrop of Windows 11 22H2 and up (build 22523: before, the
                // older way of drawing it made the window lag when moved or resized). The window
                // is transparent (tauri.windows.conf.json); the page asks for it (or not, as its
                // preferences say) before it starts: window_acrylic.
                app.state::<Backdrop>().supported.store(win::build() >= 22523, std::sync::atomic::Ordering::Relaxed);
            }
            // Windows and Linux draw no title bar of their own (tauri.windows / tauri.linux
            // .conf.json): if the page never comes, theirs comes back after a while
            #[cfg(any(windows, target_os = "linux"))]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    let ready = handle.state::<PageReady>().0.load(std::sync::atomic::Ordering::Relaxed);
                    if let (false, Some(w)) = (ready, handle.get_webview_window("main")) {
                        let _ = w.set_decorations(true);
                    }
                });
            }
            // Linux: the style of GNOME followed, the header bar of GTK 3 if chosen, then the
            // window (hidden until then)
            #[cfg(target_os = "linux")]
            linux::setup(app.handle());
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![settings_window, snap_layouts, system_accent, page_ready, window_acrylic, window_theme, app_language, decoration_layout, clipboard_text, linux_options, set_linux_options, native_chrome, tls::tls_pins, tls::tls_probe, tls::tls_fetch]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);
    builder.run(tauri::generate_context!()).expect("Thermobox could not start");
}
