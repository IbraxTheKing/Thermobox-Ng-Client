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
