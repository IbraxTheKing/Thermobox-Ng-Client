//! Windows only.
//!
//! Windows 11 shows its snap layouts when the pointer rests on the maximize button of a native
//! title bar. The title bar here is the page's: the same panel is asked for with Win + Z, then
//! a press of Alt hides the numbers it shows for the keyboard.

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
