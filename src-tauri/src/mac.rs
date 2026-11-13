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

use objc2_app_kit::{NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSRect, NSSize};

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
