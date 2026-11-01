// No console window behind the app on Windows (release builds)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Thermobox for Windows, macOS and Linux: the Angular client (../dist) in a native window.
//!
//! - macOS: the settings are only in the menu bar (Thermobox › Réglages…, ⌘,) and open in a
//!   window of their own; « À propos de Thermobox » opens the page of the app. The title bar is
//!   the page's (traffic lights over it, tauri.macos.conf.json).
//! - Windows: the page removes the native title bar once loaded (DesktopService) and draws one in
//!   the WinUI 3 style; its maximize button opens the snap layouts of Windows 11.
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

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![settings_window, snap_layouts, system_accent]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);
    builder.run(tauri::generate_context!()).expect("Thermobox could not start");
}
