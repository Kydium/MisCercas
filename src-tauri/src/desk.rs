// Cosas del Escritorio de Windows: ocultar lo que está en una cerca y vigilar «Mostrar escritorio».
use crate::store::Data;
use std::path::{Path, PathBuf};

fn key(p: &str) -> String {
    if cfg!(windows) { p.replace('/', "\\").trim_end_matches('\\').to_lowercase() } else { p.to_string() }
}

pub fn desktop_dirs(user_desktop: Option<PathBuf>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(d) = user_desktop {
        out.push(d.to_string_lossy().to_string());
    }
    let public = std::env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".into());
    out.push(Path::new(&public).join("Desktop").to_string_lossy().to_string());
    for k in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Ok(d) = std::env::var(k) {
            out.push(Path::new(&d).join("Desktop").to_string_lossy().to_string());
            out.push(Path::new(&d).join("Escritorio").to_string_lossy().to_string());
        }
    }
    out.into_iter().map(|d| key(&d)).collect()
}

pub fn in_desktop(p: &str, dirs: &[String]) -> bool {
    match Path::new(p).parent() {
        Some(par) => dirs.contains(&key(&par.to_string_lossy())),
        None => false,
    }
}

#[cfg(windows)]
mod attr {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_FLAGS_AND_ATTRIBUTES};

    fn wide(p: &str) -> Vec<u16> {
        p.encode_utf16().chain(std::iter::once(0)).collect()
    }
    pub fn is_hidden(p: &str) -> bool {
        let w = wide(p);
        let a = unsafe { GetFileAttributesW(PCWSTR(w.as_ptr())) };
        a != u32::MAX && (a & FILE_ATTRIBUTE_HIDDEN.0) != 0
    }
    pub fn set_hidden(p: &str, hide: bool) -> bool {
        let w = wide(p);
        let a = unsafe { GetFileAttributesW(PCWSTR(w.as_ptr())) };
        if a == u32::MAX {
            return false;
        }
        let n = if hide { a | FILE_ATTRIBUTE_HIDDEN.0 } else { a & !FILE_ATTRIBUTE_HIDDEN.0 };
        if n == a {
            return true;
        }
        unsafe { SetFileAttributesW(PCWSTR(w.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(n)).is_ok() }
    }
}
#[cfg(not(windows))]
mod attr {
    pub fn is_hidden(_p: &str) -> bool { false }
    pub fn set_hidden(_p: &str, _h: bool) -> bool { false }
}

/// Oculta del Escritorio lo que está en una cerca normal y muestra de nuevo lo que ya no lo está.
/// Solo se toca lo que ocultó esta aplicación. Devuelve true si cambió la lista.
pub fn sync(data: &mut Data, user_desktop: Option<PathBuf>) -> bool {
    let dirs = desktop_dirs(user_desktop);
    let mut want: std::collections::HashMap<String, String> = Default::default();
    if data.settings.hide_desktop {
        for f in data.fences.iter().filter(|f| f.portal.is_none()) {
            for it in &f.items {
                if in_desktop(&it.p, &dirs) {
                    want.insert(key(&it.p), it.p.clone());
                }
            }
        }
    }
    let mut ours: Vec<String> = data.hidden.clone();
    let before = ours.clone();
    for (k, p) in &want {
        if ours.iter().any(|o| key(o) == *k) || !Path::new(p).exists() || attr::is_hidden(p) {
            continue;
        }
        if attr::set_hidden(p, true) {
            ours.push(p.clone());
        }
    }
    ours.retain(|p| {
        if want.contains_key(&key(p)) {
            return true;
        }
        !(!Path::new(p).exists() || attr::set_hidden(p, false))
    });
    let changed = ours != before;
    data.hidden = ours;
    changed
}

/* ---------- «Mostrar escritorio» (Win+D) ---------- */
#[cfg(windows)]
pub mod guard {
    use std::collections::{HashMap, HashSet};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND};
    use windows::Win32::UI::WindowsAndMessaging::*;

    const FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(SWP_NOSIZE.0 | SWP_NOMOVE.0 | SWP_NOACTIVATE.0);

    fn hosts() -> HashSet<isize> {
        let mut v = HashSet::new();
        unsafe {
            if let Ok(h) = FindWindowExW(HWND::default(), HWND::default(), w!("Progman"), PCWSTR::null()) {
                if IsWindowVisible(h).as_bool() {
                    v.insert(h.0 as isize);
                }
            }
            let mut cur = HWND::default();
            for _ in 0..24 {
                match FindWindowExW(None, cur, w!("WorkerW"), PCWSTR::null()) {
                    Ok(h) if !h.0.is_null() => {
                        if IsWindowVisible(h).as_bool() {
                            v.insert(h.0 as isize);
                        }
                        cur = h;
                    }
                    _ => break,
                }
            }
        }
        v
    }

    fn covers(anchor: HWND) -> bool {
        let hs = hosts();
        if hs.is_empty() {
            return false;
        }
        let mut cur = anchor;
        unsafe {
            for _ in 0..3000 {
                match GetWindow(cur, GW_HWNDPREV) {
                    Ok(p) if !p.0.is_null() => {
                        if hs.contains(&(p.0 as isize)) {
                            return true;
                        }
                        cur = p;
                    }
                    _ => return false,
                }
            }
        }
        false
    }

    fn raise(h: HWND) {
        unsafe {
            let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
        }
    }

    fn lower(h: HWND) {
        unsafe {
            let _ = SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, FLAGS);
            let hs = hosts();
            let mut top = HWND::default();
            let mut cur = GetTopWindow(HWND::default()).unwrap_or_default();
            for _ in 0..3000 {
                if cur.0.is_null() {
                    break;
                }
                if hs.contains(&(cur.0 as isize)) {
                    top = cur;
                    break;
                }
                cur = GetWindow(cur, GW_HWNDNEXT).unwrap_or_default();
            }
            if top.0.is_null() {
                return;
            }
            let above = GetWindow(top, GW_HWNDPREV).unwrap_or_default();
            if above == h {
                return;
            }
            let after = if above.0.is_null() { HWND_TOP } else { above };
            let _ = SetWindowPos(h, after, 0, 0, 0, 0, FLAGS);
        }
    }

    fn raw(w: &tauri::WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| HWND(h.0 as *mut _))
    }

    pub fn start(app: AppHandle) {
        std::thread::spawn(move || {
            let anchor = unsafe {
                CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("STATIC"), w!("MisCercasAnchor"), WS_POPUP, 0, 0, 1, 1, HWND::default(), HMENU::default(), HINSTANCE::default(), None)
            };
            let Ok(anchor) = anchor else {
                eprintln!("No se pudo crear la ventana de referencia para «Mostrar escritorio».");
                return;
            };
            let mut raised: HashMap<String, Instant> = HashMap::new();
            let mut shown = false;
            let mut off = 0;
            loop {
                std::thread::sleep(Duration::from_millis(80));
                let state = app.state::<crate::AppState>();
                if covers(anchor) {
                    off = 0;
                    shown = true;
                    if state.all_hidden.load(std::sync::atomic::Ordering::SeqCst) {
                        continue;
                    }
                    for w in crate::fence_windows(&app) {
                        if w.is_always_on_top().unwrap_or(false) {
                            continue;
                        }
                        let id = w.label().to_string();
                        if raised.get(&id).map(|t| t.elapsed() < Duration::from_millis(800)).unwrap_or(false) {
                            continue;
                        }
                        if let Some(h) = raw(&w) {
                            raise(h);
                            raised.insert(id, Instant::now());
                        }
                    }
                } else if shown {
                    off += 1;
                    if off >= 2 {
                        shown = false;
                        off = 0;
                        for w in crate::fence_windows(&app) {
                            if raised.contains_key(w.label()) {
                                if let Some(h) = raw(&w) {
                                    lower(h);
                                }
                            }
                        }
                        raised.clear();
                    }
                }
            }
        });
    }
}
#[cfg(not(windows))]
pub mod guard {
    pub fn start(_app: tauri::AppHandle) {}
}
