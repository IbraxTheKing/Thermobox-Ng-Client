//! Linux: what the app takes from the desktop, and the two ways it can draw its window.
//!
//! - The window: « gnome » (the default), the page draws a header bar in the style of GNOME 4
//!   (libadwaita), its corners rounded ([round_corners]) or square; « gtk3 », the window of the
//!   system, decorated by GTK 3 with a real header bar (GtkHeaderBar): back, the sidebar, the
//!   title of the page and the main menu are native buttons and a native popover, the buttons of
//!   the window those of the desktop. The page tells what they show ([native_chrome]).
//! - The rendering of WebKitGTK: on the graphics card (its compositing) or on the processor.
//!   Without a graphics card (a virtual machine, WSL, a desktop without GPU drivers) the card is
//!   emulated by the processor (llvmpipe) and every frame of an animation took 50 to 500 ms;
//!   drawn by the processor itself, the same frames take a few. « auto » picks the processor
//!   where there is no real card ([software_only]).
//! - Where the desktop puts the buttons of the windows (gtk-decoration-layout) and whether the
//!   touchpad scrolls « naturally »: followed while the app runs, told to the page
//!   (« linux-layout », « linux-input »).
//!
//! Both choices are read before WebKit starts, from linux.json in the folder of the settings of
//! the app (Préférences writes it, then the app starts again: [set_linux_options]).

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::OnceLock;

use gtk::gio;
use gtk::glib;
use gtk::gio::prelude::*;
use gtk::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// The choices of Préférences, as stored.
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Options {
    /// "gnome" or "gtk3".
    pub window: String,
    /// "auto", "gpu" or "cpu".
    pub rendering: String,
    /// The corners of the window drawn by the page rounded, as GNOME's (« gnome » only).
    pub rounded: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { window: "gnome".into(), rendering: "auto".into(), rounded: true }
    }
}

/// The options the app started with (they apply from the start only).
static OPTIONS: OnceLock<Options> = OnceLock::new();
/// WebKitGTK draws with the processor in this run.
static SOFTWARE: AtomicBool = AtomicBool::new(false);
/// WEBKIT_DISABLE_COMPOSITING_MODE was set here, not by the user: taken away before the app
/// starts again, or the new process would inherit it whatever the new choice.
static SET_HERE: AtomicBool = AtomicBool::new(false);
/// GDK_BACKEND=x11 was set here (the rounded corners on Wayland, through XWayland): taken away
/// before the app starts again, as SET_HERE.
static X11_HERE: AtomicBool = AtomicBool::new(false);
/// The corners of the window are rounded in this run.
static ROUNDED: AtomicBool = AtomicBool::new(false);

fn options() -> Options {
    OPTIONS.get().cloned().unwrap_or_default()
}

/// linux.json, in the folder of the settings of the app (as Tauri's app_config_dir).
fn file() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join(".config")))?;
    Some(base.join("ax.ibr.thermobox").join("linux.json"))
}

/// No real graphics card to draw with: WSL, a virtual machine, or no render node of a GPU.
pub fn software_only() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() || std::env::var_os("WSL_INTEROP").is_some() {
        return true;
    }
    if std::fs::read_to_string("/proc/sys/kernel/osrelease").is_ok_and(|v| v.to_lowercase().contains("microsoft")) {
        return true;
    }
    let dmi: String = ["sys_vendor", "product_name", "board_vendor"]
        .iter()
        .filter_map(|f| std::fs::read_to_string(format!("/sys/class/dmi/id/{f}")).ok())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    const MACHINES: [&str; 9] = ["qemu", "virtualbox", "innotek", "vmware", "parallels", "xen", "bochs", "kvm", "virtual machine"];
    if MACHINES.iter().any(|m| dmi.contains(m)) {
        return true;
    }
    !std::fs::read_dir("/dev/dri").is_ok_and(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")))
}

/// First thing of main(), before WebKit starts: the options of linux.json, and the rendering
/// they ask for (WEBKIT_DISABLE_COMPOSITING_MODE, unless the user set it already); for the
/// rounded corners in a Wayland session, XWayland (GDK_BACKEND=x11, same condition).
pub fn prepare() {
    let opts: Options = file()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let set_by_user = std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some();
    let software = match opts.rendering.as_str() {
        "cpu" => true,
        "gpu" => false,
        _ => software_only(),
    };
    if !set_by_user && software {
        // Before any thread of WebKit or GTK exists
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        SET_HERE.store(true, Relaxed);
    }
    SOFTWARE.store(if set_by_user { std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some_and(|v| v != "0") } else { software }, Relaxed);
    // The rounded corners cut the window with X11 ([round_corners]): in a Wayland session, the
    // window drawn by the page goes through XWayland (where there is one, and unless the user
    // chose the backend of GDK)
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let xwayland = std::env::var_os("DISPLAY").is_some();
    if opts.window != "gtk3" && opts.rounded && wayland && xwayland && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
        X11_HERE.store(true, Relaxed);
    }
    let _ = OPTIONS.set(opts);
}

/// The window of the system (GTK 3) instead of the one drawn by the page.
pub fn native_window() -> bool {
    options().window == "gtk3"
}

/// What the page needs to know at start (desktop.ts, before Angular).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    window: String,
    rendering: String,
    /// The corners rounded, as chosen.
    rounded: bool,
    /// The corners rounded now: chosen, and a compositor to show them ([round_corners]).
    corners_rounded: bool,
    /// Drawn by the processor now.
    software: bool,
    /// What « auto » picks on this computer: the processor.
    auto_software: bool,
    /// gtk-decoration-layout, « appmenu:minimize,maximize,close ».
    layout: Option<String>,
    /// The touchpad scrolls the content with the fingers (GNOME's default).
    natural_scroll: bool,
}

pub fn info() -> Info {
    let o = options();
    Info {
        window: o.window,
        rendering: o.rendering,
        rounded: o.rounded,
        corners_rounded: ROUNDED.load(Relaxed),
        software: SOFTWARE.load(Relaxed),
        auto_software: software_only(),
        layout: layout(),
        natural_scroll: natural_scroll(),
    }
}

/// Préférences: stored, then the app starts again with them.
pub fn set_options(app: &AppHandle, window: String, rendering: String, rounded: bool) -> Result<(), String> {
    let opts = Options { window, rendering, rounded };
    let path = file().ok_or("no folder for the settings")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&opts).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if SET_HERE.load(Relaxed) {
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
    }
    if X11_HERE.load(Relaxed) {
        std::env::remove_var("GDK_BACKEND");
    }
    app.restart();
}

/// Where the desktop puts the buttons of the windows (gtk-decoration-layout, as GNOME Tweaks
/// sets it), « appmenu:minimize,maximize,close ».
pub fn layout() -> Option<String> {
    gtk::Settings::default().and_then(|s| s.gtk_decoration_layout()).map(|l| l.to_string())
}

/// org.gnome.desktop.peripherals.touchpad natural-scroll (true when GNOME does not say).
fn touchpad() -> Option<gio::Settings> {
    const SCHEMA: &str = "org.gnome.desktop.peripherals.touchpad";
    let schema = gio::SettingsSchemaSource::default()?.lookup(SCHEMA, true)?;
    schema.has_key("natural-scroll").then(|| gio::Settings::new(SCHEMA))
}

fn natural_scroll() -> bool {
    touchpad().map_or(true, |s| s.boolean("natural-scroll"))
}

/// In setup: the style of GNOME followed, the native header bar if asked, the window shown
/// (hidden until then: tauri.linux.conf.json), the changes of the desktop followed.
pub fn setup(app: &AppHandle) {
    watch_appearance(app.clone());
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(gw) = w.gtk_window() {
            if native_window() {
                build_chrome(app, &gw);
            } else if options().rounded {
                round_corners(&gw);
            }
        }
        let _ = w.show();
    }
    // Where the buttons of the windows go (GNOME Tweaks, the settings of KDE…)
    if let Some(s) = gtk::Settings::default() {
        let handle = app.clone();
        s.connect_gtk_decoration_layout_notify(move |s| {
            let _ = handle.emit("linux-layout", s.gtk_decoration_layout().map(|l| l.to_string()));
        });
    }
    if let Some(t) = touchpad() {
        let handle = app.clone();
        t.connect_changed(Some("natural-scroll"), move |s, _| {
            let _ = handle.emit("linux-input", s.boolean("natural-scroll"));
        });
        // Watched as long as the app runs
        std::mem::forget(t);
    }
}

// ---------------------------------------------------------------- the rounded corners (« gnome »)

/// The radius of the corners of a window of GNOME (libadwaita: 12 px), as --lx-radius.
const RADIUS: i32 = 12;

/// The corners of the window rounded, the page staying opaque: the window is cut.
///
/// Not Tauri's « transparent » window: it makes the page itself transparent, and WebKitGTK,
/// drawing with the processor, then painted only what changed (the rest of the window stayed
/// empty: the bug of a virtual machine). Nor a clip of what GTK draws: WebKit draws in a window
/// of its own, which it does not reach. The shape of the window (the X Shape extension) is the
/// rectangle without its four corners: the X server (or XWayland, [prepare]) shows nothing
/// outside, whatever draws inside; no compositor or alpha channel needed. The edge of the
/// corners is not smoothed, the outline drawn by the page over it is.
///
/// Square when maximized, full screen or tiled (as GNOME). Without X11 (Wayland only, no
/// XWayland) the corners stay square, and the page with them ([Info::corners_rounded]).
fn round_corners(window: &gtk::ApplicationWindow) {
    let x11 = GtkWindowExt::screen(window).is_some_and(|s| s.display().type_().name().contains("X11"));
    if !x11 {
        return;
    }
    // The shape follows the size and the state of the window
    window.connect_realize(shape);
    window.connect_size_allocate(|window, _| shape(window));
    window.connect_window_state_event(|window, _| {
        shape(window);
        glib::Propagation::Proceed
    });
    ROUNDED.store(true, Relaxed);
}

/// Maximized, full screen or tiled: square corners.
fn square(window: &gtk::ApplicationWindow) -> bool {
    window.window().is_some_and(|w| {
        w.state().intersects(gtk::gdk::WindowState::MAXIMIZED | gtk::gdk::WindowState::FULLSCREEN | gtk::gdk::WindowState::TILED)
    })
}

/// X11: the shape of the window, its rectangle without the four corners (row by row along the
/// arcs), or none when square.
fn shape(window: &gtk::ApplicationWindow) {
    let Some(gw) = window.window() else { return };
    if square(window) {
        gw.shape_combine_region(None, 0, 0);
        return;
    }
    let (w, h, r) = (window.allocated_width(), window.allocated_height(), RADIUS);
    if w < 2 * r || h < 2 * r {
        return;
    }
    let region = gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(0, r, w, h - 2 * r));
    for y in 0..r {
        // How far the arc is from the side, on this row
        let dy = r as f64 - y as f64 - 0.5;
        let inset = (r as f64 - (r as f64 * r as f64 - dy * dy).max(0.0).sqrt()).round() as i32;
        let row = |top: i32| gtk::cairo::RectangleInt::new(inset, top, w - 2 * inset, 1);
        let _ = region.union_rectangle(&row(y));
        let _ = region.union_rectangle(&row(h - 1 - y));
    }
    gw.shape_combine_region(Some(&region), 0, 0);
}

// ---------------------------------------------------------------- the native header bar (GTK 3)

/// The widgets of the header bar, on the main thread of GTK.
struct Chrome {
    window: gtk::ApplicationWindow,
    bar: gtk::HeaderBar,
    back: gtk::Button,
    sidebar: gtk::Button,
    menu: gtk::MenuButton,
}

thread_local! {
    static CHROME: RefCell<Option<Chrome>> = const { RefCell::new(None) };
}

fn icon_button(icon: &str) -> gtk::Button {
    let b = gtk::Button::from_icon_name(Some(icon), gtk::IconSize::Button);
    b.set_valign(gtk::Align::Center);
    b.set_no_show_all(true);
    b
}

/// A GtkHeaderBar as the titlebar of the window (before it is shown): back and the sidebar at
/// the start, the title, the main menu at the end; the buttons of the window where the desktop
/// puts them (show-close-button follows gtk-decoration-layout by itself).
fn build_chrome(app: &AppHandle, window: &gtk::ApplicationWindow) {
    let bar = gtk::HeaderBar::new();
    bar.set_show_close_button(true);
    bar.set_title(Some("Thermobox"));
    let back = icon_button("go-previous-symbolic");
    let sidebar = icon_button("sidebar-show-symbolic");
    let menu = gtk::MenuButton::new();
    menu.set_image(Some(&gtk::Image::from_icon_name(Some("open-menu-symbolic"), gtk::IconSize::Button)));
    menu.set_use_popover(true);
    menu.set_valign(gtk::Align::Center);
    menu.set_no_show_all(true);
    for (button, what) in [(&back, "back"), (&sidebar, "sidebar")] {
        let handle = app.clone();
        button.connect_clicked(move |_| {
            let _ = handle.emit("tb-native", what);
        });
    }
    bar.pack_start(&back);
    bar.pack_start(&sidebar);
    bar.pack_end(&menu);
    bar.show();
    window.set_titlebar(Some(&bar));
    window.set_decorated(true);
    CHROME.with(|c| {
        *c.borrow_mut() = Some(Chrome { window: window.clone(), bar, back, sidebar, menu });
    });
}

/// A button of the header bar: its tooltip, shown or not.
#[derive(Deserialize)]
pub struct NativeButton {
    label: String,
    shown: bool,
}

/// An entry of the main menu; an empty label is a separator.
#[derive(Deserialize)]
pub struct NativeMenuEntry {
    id: String,
    label: String,
}

/// What the native header bar shows ([native_chrome]).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeChrome {
    title: String,
    back: NativeButton,
    sidebar: NativeButton,
    menu_label: String,
    menu: Vec<NativeMenuEntry>,
}

/// The page tells what the native header bar shows: the title of the page, back, the sidebar
/// button, the main menu (its entries come back as « tb-native » with their id).
pub fn native_chrome(app: &AppHandle, chrome: NativeChrome) {
    let NativeChrome { title, back, sidebar, menu_label, menu } = chrome;
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        CHROME.with(|c| {
            let c = c.borrow();
            let Some(c) = c.as_ref() else { return };
            c.bar.set_title(Some(&title));
            c.back.set_tooltip_text(Some(&back.label));
            c.back.set_visible(back.shown);
            c.sidebar.set_tooltip_text(Some(&sidebar.label));
            c.sidebar.set_visible(sidebar.shown);
            c.menu.set_tooltip_text(Some(&menu_label));
            c.menu.set_visible(!menu.is_empty());
            // The menu: sections between the separators, one action per entry
            let model = gio::Menu::new();
            let actions = gio::SimpleActionGroup::new();
            let mut section = gio::Menu::new();
            for (i, entry) in menu.iter().enumerate() {
                if entry.label.is_empty() {
                    if section.n_items() > 0 {
                        model.append_section(None, &section);
                    }
                    section = gio::Menu::new();
                    continue;
                }
                let name = format!("m{i}");
                section.append(Some(&entry.label), Some(&format!("tb.{name}")));
                let action = gio::SimpleAction::new(&name, None);
                let (h, id) = (handle.clone(), entry.id.clone());
                action.connect_activate(move |_, _| {
                    let _ = h.emit("tb-native", id.as_str());
                });
                actions.add_action(&action);
            }
            if section.n_items() > 0 {
                model.append_section(None, &section);
            }
            c.window.insert_action_group("tb", Some(&actions));
            c.menu.set_menu_model(Some(&model));
        });
    });
}

// ---------------------------------------------------------------- the style of GNOME

/// GNOME: the accent chosen in Settings › Appearance, null on other desktops (or before 47).
pub fn gnome_accent() -> Option<String> {
    use gtk::gio::prelude::SettingsExt;
    const SCHEMA: &str = "org.gnome.desktop.interface";
    let source = gtk::gio::SettingsSchemaSource::default()?;
    let schema = source.lookup(SCHEMA, true)?;
    if !schema.has_key("accent-color") {
        return None;
    }
    let name = gtk::gio::Settings::new(SCHEMA).string("accent-color");
    let hex = match name.as_str() {
        "blue" => "#3584e4",
        "teal" => "#2190a4",
        "green" => "#3a944a",
        "yellow" => "#c88800",
        "orange" => "#ed5b00",
        "red" => "#e62d42",
        "pink" => "#d56199",
        "purple" => "#9141ac",
        "slate" => "#6f8396",
        _ => return None,
    };
    Some(hex.to_string())
}

/// Linux: the app follows the theme of the system (Préférences › Thème › Système), [window_theme].
static FOLLOW_SYSTEM: AtomicBool = AtomicBool::new(true);

/// GNOME: the light or dark style of the system (Settings › Appearance, the quick settings) is the
/// color-scheme of org.gnome.desktop.interface. GTK 3 (Tauri, WebKitGTK) does not read it: the
/// page kept the theme the app started with. Given to GTK as its prefer-dark-theme, which
/// WebKitGTK follows (prefers-color-scheme in the page), when the app follows the system.
fn apply_color_scheme(settings: &gtk::gio::Settings) {
    use gtk::gio::prelude::SettingsExt;
    use gtk::prelude::GtkSettingsExt;
    if !FOLLOW_SYSTEM.load(Relaxed) {
        return;
    }
    if let Some(gtk_settings) = gtk::Settings::default() {
        gtk_settings.set_gtk_application_prefer_dark_theme(settings.string("color-scheme") == "prefer-dark");
    }
}

/// GNOME: the settings of org.gnome.desktop.interface that have a color-scheme, if any.
fn gnome_interface() -> Option<gtk::gio::Settings> {
    const SCHEMA: &str = "org.gnome.desktop.interface";
    let schema = gtk::gio::SettingsSchemaSource::default()?.lookup(SCHEMA, true)?;
    schema.has_key("color-scheme").then(|| gtk::gio::Settings::new(SCHEMA))
}

/// GNOME: the style and the accent of the system, followed while the app runs. A change of the
/// style goes to GTK (apply_color_scheme); a change of the style or of the accent is told to the
/// page (« system-appearance »: it reads system_accent again).
fn watch_appearance(handle: AppHandle) {
    use gtk::gio::prelude::SettingsExt;
    let Some(settings) = gnome_interface() else { return };
    apply_color_scheme(&settings);
    settings.connect_changed(None, move |settings, key| {
        if key == "color-scheme" {
            apply_color_scheme(settings);
        }
        if matches!(key, "color-scheme" | "accent-color" | "gtk-theme") {
            let _ = handle.emit("system-appearance", ());
        }
    });
    // Watched as long as the app runs
    std::mem::forget(settings);
}

/// The theme of the window ([theme]: the one picked, null: the system's). set_theme(None) put GTK
/// back to light, whatever the style of GNOME (and the page, which follows it, came back to light
/// at once): the style of GNOME is given instead; a theme picked in the app: the changes of the
/// system are left aside.
pub fn window_theme(window: &tauri::WebviewWindow, theme: Option<&str>, forced: Option<tauri::Theme>) {
    if forced.is_some() {
        let _ = window.set_theme(forced);
    }
    FOLLOW_SYSTEM.store(theme.is_none(), Relaxed);
    if theme.is_none() {
        let _ = window.run_on_main_thread(|| {
            if let Some(settings) = gnome_interface() {
                apply_color_scheme(&settings);
            }
        });
    }
}
