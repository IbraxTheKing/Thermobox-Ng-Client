//! The menu bar of macOS: « Réglages… » (⌘,) opens the settings window, the only way to them
//! there. Windows and Linux have no menu bar: everything is in the page. In the language of the
//! app (crate::french), built again when it changes.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let fr = crate::french();
    let t = |f: &'static str, e: &'static str| if fr { f } else { e };
    let about = MenuItem::with_id(app, "about", t("À propos de Thermobox", "About Thermobox"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", t("Réglages…", "Settings…"), true, Some("CmdOrCtrl+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "Thermobox",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(t("Services", "Services")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(t("Masquer Thermobox", "Hide Thermobox")))?,
            &PredefinedMenuItem::hide_others(app, Some(t("Masquer les autres", "Hide Others")))?,
            &PredefinedMenuItem::show_all(app, Some(t("Tout afficher", "Show All")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(t("Quitter Thermobox", "Quit Thermobox")))?,
        ],
    )?;
    // Without an Edit menu, ⌘C / ⌘V / ⌘A do nothing in the fields of the page
    let edit = Submenu::with_items(
        app,
        t("Édition", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t("Annuler", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(t("Rétablir", "Redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t("Couper", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(t("Copier", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(t("Coller", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(t("Tout sélectionner", "Select All")))?,
        ],
    )?;
    let view = Submenu::with_items(app, t("Présentation", "View"), true, &[&PredefinedMenuItem::fullscreen(app, Some(t("Plein écran", "Enter Full Screen")))?])?;
    let window = Submenu::with_items(
        app,
        t("Fenêtre", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t("Réduire", "Minimize")))?,
            &PredefinedMenuItem::maximize(app, Some(t("Agrandir", "Zoom")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(t("Fermer la fenêtre", "Close Window")))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "settings" => {
            let _ = crate::open_settings(app);
        }
        "about" => {
            let _ = crate::open_about(app);
        }
        _ => {}
    }
}
