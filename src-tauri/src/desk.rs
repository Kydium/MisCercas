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
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{GetLastError, HINSTANCE, HWND};
    use windows::Win32::UI::WindowsAndMessaging::*;

    const FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(SWP_NOSIZE.0 | SWP_NOMOVE.0 | SWP_NOACTIVATE.0);
    static LINES: AtomicU32 = AtomicU32::new(0);

    fn log(app: &AppHandle, msg: String) {
        if LINES.fetch_add(1, Ordering::SeqCst) > 400 {
            return;
        }
        let st = app.state::<crate::AppState>();
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(st.dir.join("guard.log")) {
            use std::io::Write;
            let _ = writeln!(f, "[{t}] {msg}");
        }
    }

    fn class_of(h: HWND) -> String {
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn is_top(h: HWND) -> bool {
        unsafe { (GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0) != 0 }
    }

    /// Ventanas que forman el escritorio: Program Manager y las WorkerW visibles.
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
                match FindWindowExW(HWND::default(), cur, w!("WorkerW"), PCWSTR::null()) {
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

    /// ¿Hay alguna ventana del escritorio por encima de `h` en el orden de ventanas?
    fn host_above(h: HWND, hs: &HashSet<isize>) -> bool {
        let mut cur = h;
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

    /// Sube las cercas al primer plano (aunque ya fueran «siempre encima» pero quedaran bajo el escritorio).
    fn raise_all(app: &AppHandle, hs: Vec<isize>) {
        if hs.is_empty() {
            return;
        }
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || unsafe {
            for h in hs {
                let h = HWND(h as *mut _);
                if is_top(h) {
                    let _ = SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, FLAGS);
                }
                if SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS).is_err() {
                    log(&app2, format!("SetWindowPos falló en {:?}: error {}", h.0, GetLastError().0));
                }
            }
        });
    }

    fn lower_all(app: &AppHandle, hs: Vec<isize>) {
        let _ = app.run_on_main_thread(move || {
            for h in hs {
                lower(HWND(h as *mut _));
            }
        });
    }

    fn raw(w: &tauri::WebviewWindow) -> Option<HWND> {
        w.hwnd().ok().map(|h| HWND(h.0 as *mut _))
    }

    fn states(app: &AppHandle) -> String {
        let hs = hosts();
        let hosts_txt = hs.iter().map(|h| format!("{}:top={}", class_of(HWND(*h as *mut _)), is_top(HWND(*h as *mut _)) as u8)).collect::<Vec<_>>().join(",");
        let fg = unsafe { GetForegroundWindow() };
        let fences = crate::fence_windows(app)
            .iter()
            .map(|w| match raw(w) {
                Some(h) => unsafe {
                    format!(
                        "{}:vis={} ico={} top={} bajoEscritorio={}",
                        &w.label()[w.label().len().saturating_sub(4)..],
                        IsWindowVisible(h).as_bool() as u8,
                        IsIconic(h).as_bool() as u8,
                        is_top(h) as u8,
                        host_above(h, &hs) as u8
                    )
                },
                None => "?".into(),
            })
            .collect::<Vec<_>>()
            .join(" | ");
        format!("primer plano={} escritorios=[{}] {}", class_of(fg), hosts_txt, fences)
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
            let mut raised = HashSet::<String>::new();
            let mut shown_at: Option<Instant> = None;
            let mut sampled = 0u8;
            let mut off = 0;
            loop {
                std::thread::sleep(Duration::from_millis(50));
                let state = app.state::<crate::AppState>();
                let hidden_by_user = state.all_hidden.load(Ordering::SeqCst);
                let hs = hosts();
                // desde el anclaje hacia arriba: ¿hay un escritorio encima?
                let covers = host_above(anchor, &hs);
                if !hidden_by_user {
                    // una cerca minimizada u oculta por Windows se vuelve a mostrar sin quitar el foco
                    for w in crate::fence_windows(&app) {
                        if let Some(h) = raw(&w) {
                            unsafe {
                                if IsIconic(h).as_bool() || !IsWindowVisible(h).as_bool() {
                                    log(&app, format!("rescate {}", w.label()));
                                    let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                                    let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
                                    raised.insert(w.label().to_string());
                                }
                            }
                        }
                    }
                }
                if covers {
                    off = 0;
                    if shown_at.is_none() {
                        shown_at = Some(Instant::now());
                        sampled = 0;
                        log(&app, format!("escritorio encima; {}", states(&app)));
                    }
                    if hidden_by_user {
                        continue;
                    }
                    let mut todo = vec![];
                    for w in crate::fence_windows(&app) {
                        if let Some(h) = raw(&w) {
                            if !is_top(h) || host_above(h, &hs) {
                                todo.push(h.0 as isize);
                                raised.insert(w.label().to_string());
                            }
                        }
                    }
                    if !todo.is_empty() {
                        log(&app, format!("subiendo {} cerca(s)", todo.len()));
                    }
                    raise_all(&app, todo);
                    if let Some(t) = shown_at {
                        let ms = t.elapsed().as_millis();
                        if (sampled == 0 && ms > 250) || (sampled == 1 && ms > 1000) {
                            sampled += 1;
                            log(&app, format!("durante ({ms} ms); {}", states(&app)));
                        }
                    }
                } else if shown_at.is_some() {
                    off += 1;
                    if off >= 10 {
                        shown_at = None;
                        off = 0;
                        log(&app, format!("escritorio detrás; {}", states(&app)));
                        let mut hl = vec![];
                        for w in crate::fence_windows(&app) {
                            if raised.contains(w.label()) && !w.is_always_on_top().unwrap_or(false) {
                                if let Some(h) = raw(&w) {
                                    hl.push(h.0 as isize);
                                }
                            }
                        }
                        lower_all(&app, hl);
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
