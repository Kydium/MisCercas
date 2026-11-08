// Utilidades del sistema: diálogos, inicio con Windows, abrir en el Explorador, botón del ratón.
use std::path::PathBuf;

#[cfg(windows)]
fn no_window(c: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000)
}

#[cfg(windows)]
pub fn pick_folder() -> Option<PathBuf> {
    rfd::FileDialog::new().set_title("Elige una carpeta").pick_folder()
}
#[cfg(not(windows))]
pub fn pick_folder() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
pub fn save_json(name: &str) -> Option<PathBuf> {
    rfd::FileDialog::new().set_title("Exportar configuración").set_file_name(name).add_filter("Configuración (JSON)", &["json"]).save_file()
}
#[cfg(not(windows))]
pub fn save_json(_n: &str) -> Option<PathBuf> {
    None
}

#[cfg(windows)]
pub fn open_json() -> Option<PathBuf> {
    rfd::FileDialog::new().set_title("Importar configuración").add_filter("Configuración (JSON)", &["json"]).pick_file()
}
#[cfg(not(windows))]
pub fn open_json() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
pub fn confirm(title: &str, message: &str, detail: &str) -> bool {
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title(title)
        .set_description(&format!("{message}\n\n{detail}"))
        .set_buttons(rfd::MessageButtons::YesNo)
        .show()
        == rfd::MessageDialogResult::Yes
}
#[cfg(not(windows))]
pub fn confirm(_t: &str, _m: &str, _d: &str) -> bool {
    false
}

#[cfg(windows)]
pub fn show_in_folder(path: &str) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("explorer.exe").raw_arg(format!("/select,\"{}\"", path.replace('/', "\\"))).spawn();
}
#[cfg(not(windows))]
pub fn show_in_folder(_p: &str) {}

const RUN_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(windows)]
pub fn autostart_get() -> bool {
    let mut c = std::process::Command::new("reg");
    c.args(["query", RUN_KEY, "/v", "MisCercas"]);
    no_window(&mut c).output().map(|o| o.status.success()).unwrap_or(false)
}
#[cfg(not(windows))]
pub fn autostart_get() -> bool {
    false
}

#[cfg(windows)]
pub fn autostart_set(on: bool) -> bool {
    let mut c = std::process::Command::new("reg");
    if on {
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        c.args(["add", RUN_KEY, "/v", "MisCercas", "/t", "REG_SZ", "/d", &format!("\"{exe}\""), "/f"]);
    } else {
        c.args(["delete", RUN_KEY, "/v", "MisCercas", "/f"]);
    }
    no_window(&mut c).output().map(|o| o.status.success()).unwrap_or(false) || !on
}
#[cfg(not(windows))]
pub fn autostart_set(_on: bool) -> bool {
    false
}

#[cfg(windows)]
pub fn mouse_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}
#[cfg(not(windows))]
pub fn mouse_down() -> bool {
    false
}
