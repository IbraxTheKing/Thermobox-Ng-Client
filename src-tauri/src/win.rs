//! Windows only.
//!
//! - Windows 11 shows its snap layouts when the pointer rests on the maximize button of a native
//!   title bar. The title bar here is the page's: the same panel is asked for with Win + Z, then
//!   a press of Alt hides the numbers it shows for the keyboard.
//! - The accent colour of the system, the build of Windows (the backdrop of the window), the dark
//!   or light frame of the window.
//! - The text of the clipboard, for « Coller » in the menus drawn by the page (WebView2 does not
//!   let a page read it with execCommand).

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN, VK_MENU,
};

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn send(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

pub fn snap_layouts() {
    const VK_Z: VIRTUAL_KEY = 0x5A;
    send(&[key(VK_LWIN, false), key(VK_Z, false), key(VK_Z, true), key(VK_LWIN, true)]);
    std::thread::sleep(std::time::Duration::from_millis(60));
    send(&[key(VK_MENU, false), key(VK_MENU, true)]);
}

/// The accent colour chosen in Settings › Personalisation › Colours, as #rrggbb (the DWORD of
/// the registry is 0xAABBGGRR).
pub fn accent() -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide("Software\\Microsoft\\Windows\\DWM");
    let name = wide("AccentColor");
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut value as *mut u32 as *mut core::ffi::c_void,
            &mut size,
        )
    };
    (status == ERROR_SUCCESS).then(|| format!("#{:02x}{:02x}{:02x}", value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff))
}

/// Build of Windows (22000 and up: Windows 11), 0 if unknown.
pub fn build() -> u32 {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let name = wide("CurrentBuildNumber");
    let mut value = [0u16; 32];
    let mut size = std::mem::size_of_val(&value) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            value.as_mut_ptr() as *mut core::ffi::c_void,
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return 0;
    }
    let end = value.iter().position(|&c| c == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end]).trim().parse().unwrap_or(0)
}

/// Dark or light frame and backdrop for the window, whatever the theme of the system (the
/// attribute that set_theme also sets: set again here, the Acrylic is redrawn with it).
pub fn dark_mode(hwnd: *mut core::ffi::c_void, dark: bool) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
    let value: i32 = dark as i32;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &value as *const i32 as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// The Acrylic of the system behind the window ([on]), or none: whether it is shown now.
pub fn acrylic(window: &tauri::WebviewWindow, on: bool) -> bool {
    let done = if on {
        window.set_effects(tauri::window::EffectsBuilder::new().effect(tauri::window::Effect::Acrylic).build())
    } else {
        window.set_effects(None)
    };
    on && done.is_ok()
}

/// The theme shown ([dark]): the colours Windows draws around the window, the tint of its Acrylic
/// ([acrylic]: shown), which does not take a new theme by itself: it is put back.
pub fn window_theme(window: &tauri::WebviewWindow, dark: bool, acrylic: bool) {
    if let Ok(hwnd) = window.hwnd() {
        dark_mode(hwnd.0, dark);
    }
    if acrylic {
        let _ = window.set_effects(None);
        let _ = window.set_effects(tauri::window::EffectsBuilder::new().effect(tauri::window::Effect::Acrylic).build());
    }
}

/// The text in the clipboard (CF_UNICODETEXT), None when there is none or it is taken.
pub fn clipboard_text() -> Option<String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    const CF_UNICODETEXT: u32 = 13;
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let data = GetClipboardData(CF_UNICODETEXT);
        let mut text = None;
        if !data.is_null() {
            let p = GlobalLock(data) as *const u16;
            if !p.is_null() {
                let mut n = 0;
                while *p.add(n) != 0 {
                    n += 1;
                }
                text = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, n)));
                GlobalUnlock(data);
            }
        }
        CloseClipboard();
        text
    }
}
