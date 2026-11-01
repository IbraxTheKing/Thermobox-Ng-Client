//! The menu bar of macOS: « Réglages… » (⌘,) opens the settings window, the only way to them
//! there. Windows and Linux have no menu bar: everything is in the page.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let about = MenuItem::with_id(app, "about", "À propos de Thermobox", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Réglages…", true, Some("CmdOrCtrl+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "Thermobox",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Services"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Masquer Thermobox"))?,
            &PredefinedMenuItem::hide_others(app, Some("Masquer les autres"))?,
            &PredefinedMenuItem::show_all(app, Some("Tout afficher"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quitter Thermobox"))?,
        ],
    )?;
    // Without an Edit menu, ⌘C / ⌘V / ⌘A do nothing in the fields of the page
    let edit = Submenu::with_items(
        app,
        "Édition",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Annuler"))?,
            &PredefinedMenuItem::redo(app, Some("Rétablir"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Couper"))?,
            &PredefinedMenuItem::copy(app, Some("Copier"))?,
            &PredefinedMenuItem::paste(app, Some("Coller"))?,
            &PredefinedMenuItem::select_all(app, Some("Tout sélectionner"))?,
        ],
    )?;
    let view = Submenu::with_items(app, "Présentation", true, &[&PredefinedMenuItem::fullscreen(app, Some("Plein écran"))?])?;
    let window = Submenu::with_items(
        app,
        "Fenêtre",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Réduire"))?,
            &PredefinedMenuItem::maximize(app, Some("Agrandir"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Fermer la fenêtre"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "settings" => {
            let _ = crate::open_settings(app);
        }
        "about" => crate::open_page(app, "about"),
        _ => {}
    }
}
