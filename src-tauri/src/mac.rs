//! macOS: the material of the window, as the apps of the system draw it behind their side bar.
//!
//! - macOS 26 (Tahoe) and up: Liquid Glass (NSGlassEffectView, tauri-plugin-liquid-glass).
//! - macOS 11 to 15 (Big Sur to Sequoia): the vibrancy of a side bar (NSVisualEffectView,
//!   material Sidebar), active while the window is.
//!
//! The material is behind the whole window (transparent, tauri.macos.conf.json): the page paints
//! its content and leaves the side bar see-through (macos.css). It asks which one it has
//! ([style]): "glass", "vibrancy", or "" when neither could be set (it then paints everything).

use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{Runtime, WebviewWindow};
use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};

/// The material set on each window, by its label.
#[derive(Default)]
pub struct Materials(std::sync::Mutex<std::collections::HashMap<String, &'static str>>);

impl Materials {
    pub fn of(&self, label: &str) -> &'static str {
        self.0.lock().map(|m| m.get(label).copied().unwrap_or("")).unwrap_or("")
    }
}

/// Sets the material of [window] and keeps which one it is.
pub fn apply<R: Runtime>(window: &WebviewWindow<R>, materials: &Materials) {
    let style = material(window);
    if let Ok(mut m) = materials.0.lock() {
        m.insert(window.label().to_string(), style);
    }
}

fn material<R: Runtime>(window: &WebviewWindow<R>) -> &'static str {
    let glass = window.liquid_glass();
    if glass.is_supported() {
        let config = LiquidGlassConfig {
            enabled: true,
            corner_radius: 0.0,
            tint_color: None,
            variant: GlassMaterialVariant::Sidebar,
        };
        if glass.set_effect(window, config).is_ok() {
            return "glass";
        }
    }
    let effects = EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(EffectState::FollowsWindowActiveState)
        .build();
    if window.set_effects(effects).is_ok() {
        return "vibrancy";
    }
    ""
}

/// The version of macOS, (major, minor): 26 for Tahoe, 15 for Sequoia… (sw_vers).
pub fn version() -> (u32, u32) {
    let out = std::process::Command::new("sw_vers").arg("-productVersion").output();
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let mut parts = text.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

// ============================== The page in the window: the frame of AppKit around it

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{msg_send, MainThreadMarker, Message};
use objc2_app_kit::{
    NSAboutPanelOptionApplicationName, NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionCredits, NSAboutPanelOptionVersion,
    NSApplication, NSColor, NSFont, NSFontAttributeName, NSForegroundColorAttributeName, NSLinkAttributeName, NSMutableParagraphStyle,
    NSParagraphStyleAttributeName, NSTextAlignment, NSWindow, NSWindowButton,
};
use objc2_foundation::{ns_string, NSAttributedString, NSDictionary, NSMutableAttributedString, NSPoint, NSRect, NSSize, NSString};

fn any<T: Message>(object: Retained<T>) -> Retained<AnyObject> {
    // Every Objective-C object is an AnyObject
    unsafe { Retained::cast_unchecked(object) }
}

/// The swipe of two fingers on the trackpad goes back and forward between the pages, the page
/// before following the fingers (WebKit: the history of the page, Angular's included), as in
/// Safari.
pub fn gestures<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|w| unsafe {
        if let Some(view) = (w.inner() as *mut AnyObject).as_ref() {
            let _: () = msg_send![view, setAllowsBackForwardNavigationGestures: Bool::YES];
        }
    });
}

/// Where the traffic lights are in [window], in points from its top left corner: the left edge
/// of the first, the right edge of the last, their middle. The toolbar of the page centres its
/// buttons on them, whatever the version of macOS draws them.
pub fn lights<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64, f64)> {
    let ns = unsafe { (window.ns_window().ok()? as *mut NSWindow).as_ref() }?;
    let close = ns.standardWindowButton(NSWindowButton::CloseButton)?;
    let zoom = ns.standardWindowButton(NSWindowButton::ZoomButton)?;
    let height = ns.contentView()?.frame().size.height;
    // In the coordinates of the window, from its bottom
    let c = close.convertRect_toView(close.bounds(), None);
    let z = zoom.convertRect_toView(zoom.bounds(), None);
    if c.size.height <= 0.0 {
        return None;
    }
    Some((c.origin.x, z.origin.x + z.size.width, height - (c.origin.y + c.size.height / 2.0)))
}

/// The settings window takes the height of its tab, its top edge where it is, animated as the
/// settings windows of the system (no more than the screen).
pub fn settings_height<R: Runtime>(window: &WebviewWindow<R>, height: f64) {
    let Some(ns) = (unsafe { (window.ns_window().ok().map(|p| p as *mut NSWindow)).and_then(|p| p.as_ref()) }) else { return };
    let frame = ns.frame();
    let room = ns.screen().map(|s| s.visibleFrame().size.height).unwrap_or(f64::MAX);
    let h = height.round().clamp(240.0, room.max(240.0));
    if (h - frame.size.height).abs() < 1.0 {
        return;
    }
    let to = NSRect::new(NSPoint::new(frame.origin.x, frame.origin.y + frame.size.height - h), NSSize::new(frame.size.width, h));
    ns.setFrame_display_animate(to, true, ns.isVisible());
}

/// A line of the credits of the About panel: a title, a text, a link, or a quieter text.
#[derive(serde::Deserialize)]
pub struct AboutLine {
    pub text: String,
    #[serde(default)]
    pub link: Option<String>,
    /// "title", "muted", or nothing.
    #[serde(default)]
    pub kind: String,
}

/// What the About panel shows (the page writes it, in its language).
#[derive(serde::Deserialize)]
pub struct AboutInfo {
    pub name: String,
    /// « 26.12.0 »: after « Version ».
    pub version: String,
    /// In brackets after it (the commit); empty: nothing.
    #[serde(default)]
    pub build: String,
    pub copyright: String,
    pub lines: Vec<AboutLine>,
}

/// The About panel of macOS (NSApplication, orderFrontStandardAboutPanel): the icon of the app,
/// its name and version, the credits (centred, the links clickable, in the colours of the theme),
/// the copyright.
pub fn about_panel(info: &AboutInfo, mtm: MainThreadMarker) {
    let credits = NSMutableAttributedString::from_nsstring(&NSString::from_str(""));
    let paragraph = NSMutableParagraphStyle::new();
    // NSTextAlignmentCenter: 1 on Apple silicon (the values of iOS), 2 on Intel
    paragraph.setAlignment(NSTextAlignment(if cfg!(target_arch = "aarch64") { 1 } else { 2 }));
    paragraph.setParagraphSpacing(2.0);
    let count = info.lines.len();
    for (i, line) in info.lines.iter().enumerate() {
        let text = if i + 1 < count { format!("{}\n", line.text) } else { line.text.clone() };
        let font = if line.kind == "title" { NSFont::boldSystemFontOfSize(11.0) } else { NSFont::systemFontOfSize(11.0) };
        let colour = if line.kind == "muted" { NSColor::secondaryLabelColor() } else { NSColor::labelColor() };
        let mut keys: Vec<&NSString> = unsafe { vec![NSFontAttributeName, NSForegroundColorAttributeName, NSParagraphStyleAttributeName] };
        let mut values: Vec<Retained<AnyObject>> = vec![any(font), any(colour), any(paragraph.clone())];
        if let Some(link) = &line.link {
            keys.push(unsafe { NSLinkAttributeName });
            values.push(any(NSString::from_str(link)));
        }
        let attributes = NSDictionary::from_retained_objects(&keys, &values);
        let part = unsafe { NSAttributedString::new_with_attributes(&NSString::from_str(&text), &attributes) };
        credits.appendAttributedString(&part);
    }
    let keys: Vec<&NSString> = unsafe {
        vec![NSAboutPanelOptionApplicationName, NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionVersion, ns_string!("Copyright"), NSAboutPanelOptionCredits]
    };
    let values: Vec<Retained<AnyObject>> = vec![
        any(NSString::from_str(&info.name)),
        any(NSString::from_str(&info.version)),
        any(NSString::from_str(&info.build)),
        any(NSString::from_str(&info.copyright)),
        any(credits),
    ];
    let options = NSDictionary::from_retained_objects(&keys, &values);
    unsafe { NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanelWithOptions(&options) };
}
