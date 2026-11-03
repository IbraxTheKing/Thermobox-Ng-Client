//! Linux: what the app takes from the desktop, and the two ways it can draw its window.
//!
//! - The window: « gnome » (the default), the page draws a header bar in the style of GNOME 4
//!   (libadwaita), the window square (not transparent: a transparent window kept WebKitGTK,
//!   drawing with the processor, from painting the page but where something changed); « gtk3 », the window of the
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
}

impl Default for Options {
    fn default() -> Self {
        Options { window: "gnome".into(), rendering: "auto".into() }
    }
}

/// The options the app started with (they apply from the start only).
static OPTIONS: OnceLock<Options> = OnceLock::new();
/// WebKitGTK draws with the processor in this run.
static SOFTWARE: AtomicBool = AtomicBool::new(false);
/// WEBKIT_DISABLE_COMPOSITING_MODE was set here, not by the user: taken away before the app
/// starts again, or the new process would inherit it whatever the new choice.
static SET_HERE: AtomicBool = AtomicBool::new(false);

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
/// they ask for (WEBKIT_DISABLE_COMPOSITING_MODE, unless the user set it already).
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
        software: SOFTWARE.load(Relaxed),
        auto_software: software_only(),
        layout: layout(),
        natural_scroll: natural_scroll(),
    }
}

/// Préférences: stored, then the app starts again with them.
pub fn set_options(app: &AppHandle, window: String, rendering: String) -> Result<(), String> {
    let opts = Options { window, rendering };
    let path = file().ok_or("no folder for the settings")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&opts).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if SET_HERE.load(Relaxed) {
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
    }
    app.restart();
}

fn layout() -> Option<String> {
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

/// In setup: the native header bar if asked, the window shown (hidden until then:
/// tauri.linux.conf.json), the changes of the desktop followed.
pub fn setup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if native_window() {
            if let Ok(gw) = w.gtk_window() {
                build_chrome(app, &gw);
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
