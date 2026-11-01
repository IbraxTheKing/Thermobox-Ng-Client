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
//! - Linux: the title bar of the desktop (GTK 3 / WebKitGTK 4.1, the toolkit of Tauri).
//!
//! API calls go through tauri-plugin-http (see src/app/core/desktop.ts).

#[cfg(target_os = "macos")]
mod menu;
#[cfg(windows)]
mod win;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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
        .title("Réglages")
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

/// The accent colour of the system, #rrggbb: Windows (its registry). Elsewhere the page reads the
/// CSS colour AccentColor itself (WebKit of macOS and Linux); null when there is none.
#[tauri::command]
fn system_accent() -> Option<String> {
    #[cfg(windows)]
    return win::accent();
    #[cfg(not(windows))]
    None
}

/// The page has drawn its title bar (Windows, index.html): no need for the system's, even if it
/// came back meanwhile.
#[tauri::command]
fn page_ready(window: tauri::WebviewWindow, ready: tauri::State<'_, PageReady>) {
    ready.0.store(true, std::sync::atomic::Ordering::Relaxed);
    #[cfg(windows)]
    if window.is_decorated().unwrap_or(false) {
        let _ = window.set_decorations(false);
    }
    let _ = window;
}

/// The backdrop of the window drawn by the system: "acrylic" (Windows 11), null elsewhere (the
/// page is opaque).
#[tauri::command]
fn window_backdrop(backdrop: tauri::State<'_, Backdrop>) -> Option<&'static str> {
    backdrop.0.get().copied().flatten()
}

/// The theme shown by the page ("light" or "dark") for the window: the colours Windows draws
/// around it and the tint of its Acrylic. The Acrylic of Windows does not take a new theme by
/// itself: it is put back after the change.
#[tauri::command]
fn window_theme(window: tauri::WebviewWindow, theme: String, backdrop: tauri::State<'_, Backdrop>) {
    let dark = theme == "dark";
    let _ = window.set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    #[cfg(windows)]
    {
        if let Ok(hwnd) = window.hwnd() {
            win::dark_mode(hwnd.0, dark);
        }
        if backdrop.0.get().copied().flatten().is_some() {
            let _ = window.set_effects(None);
            let _ = window.set_effects(tauri::window::EffectsBuilder::new().effect(tauri::window::Effect::Acrylic).build());
        }
    }
    let _ = (dark, backdrop);
}

/// Set once at start ([window_backdrop]).
#[derive(Default)]
struct Backdrop(std::sync::OnceLock<Option<&'static str>>);

/// Set by [page_ready]. Windows: a page that never comes (its files out of reach, a debug build
/// started without `ng serve`) would leave a window without any title bar, impossible to move or
/// close: after a while, the title bar of Windows comes back.
#[derive(Default)]
struct PageReady(std::sync::atomic::AtomicBool);

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PageReady::default())
        .manage(Backdrop::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                // Acrylic: the DWM backdrop of Windows 11 22H2 and up (build 22523: before, the
                // older way of drawing it made the window lag when moved or resized). The window
                // is transparent (tauri.windows.conf.json), the page leaves its side bar clear.
                let acrylic = win::build() >= 22523
                    && app.get_webview_window("main").is_some_and(|w| {
                        w.set_effects(tauri::window::EffectsBuilder::new().effect(tauri::window::Effect::Acrylic).build()).is_ok()
                    });
                let _ = app.state::<Backdrop>().0.set(acrylic.then_some("acrylic"));
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    let ready = handle.state::<PageReady>().0.load(std::sync::atomic::Ordering::Relaxed);
                    if let (false, Some(w)) = (ready, handle.get_webview_window("main")) {
                        let _ = w.set_decorations(true);
                    }
                });
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![settings_window, snap_layouts, system_accent, page_ready, window_backdrop, window_theme]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);
    builder.run(tauri::generate_context!()).expect("Thermobox could not start");
}
