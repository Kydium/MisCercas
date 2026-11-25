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

/// Versiones anteriores ocultaban los accesos con el atributo «oculto»: se vuelven a mostrar.
pub fn unhide_legacy(data: &mut Data) {
    for p in data.hidden.drain(..) {
        if Path::new(&p).exists() {
            attr::set_hidden(&p, false);
        }
    }
}

/* ---------- carpeta propia de Mis Cercas ---------- */
fn folder_name(title: &str) -> String {
    let cleaned: String = title.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let t = cleaned.trim().trim_matches('.').trim().to_string();
    let t: String = t.chars().take(60).collect();
    if t.is_empty() { "Cerca".into() } else { t }
}

fn unique_in(dir: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 2..1000 {
        let c = dir.join(format!("{stem} ({n}){ext}"));
        if !c.exists() {
            return c;
        }
    }
    first
}

fn move_path(from: &Path, to_dir: &Path) -> Option<PathBuf> {
    std::fs::create_dir_all(to_dir).ok()?;
    let dest = unique_in(to_dir, from.file_name()?);
    if std::fs::rename(from, &dest).is_ok() {
        return Some(dest);
    }
    // otra unidad: se copia y luego se borra (solo archivos)
    if from.is_file() && std::fs::copy(from, &dest).is_ok() {
        if std::fs::remove_file(from).is_ok() {
            return Some(dest);
        }
        let _ = std::fs::remove_file(&dest);
    }
    None
}

pub fn in_store(p: &str, store: &Path) -> bool {
    let s = key(&store.to_string_lossy());
    key(p).starts_with(&format!("{s}\\")) || key(p).starts_with(&format!("{s}/"))
}

/// Lo que se pone en una cerca desde el Escritorio se guarda en «Mis Cercas\<nombre de la cerca>».
/// Devuelve los ids de las cercas que cambiaron.
pub fn adopt(data: &mut Data, user_desktop: Option<PathBuf>, store: &Path, only: Option<&str>) -> Vec<String> {
    let mut changed = vec![];
    if !data.settings.hide_desktop {
        return changed;
    }
    let dirs = desktop_dirs(user_desktop);
    for f in data.fences.iter_mut().filter(|f| f.portal.is_none() && only.map(|o| o == f.id).unwrap_or(true)) {
        let dest = store.join(folder_name(&f.title));
        let mut any = false;
        for it in f.items.iter_mut() {
            if in_desktop(&it.p, &dirs) && Path::new(&it.p).exists() {
                if let Some(n) = move_path(Path::new(&it.p), &dest) {
                    it.p = n.to_string_lossy().to_string();
                    any = true;
                }
            }
        }
        if any {
            changed.push(f.id.clone());
        }
    }
    changed
}

/// Devuelve un elemento de la carpeta de Mis Cercas al Escritorio. Da su nueva ruta.
pub fn give_back(path: &str, store: &Path, user_desktop: Option<PathBuf>) -> Option<String> {
    if !in_store(path, store) {
        return None;
    }
    let desk = user_desktop?;
    move_path(Path::new(path), &desk).map(|p| p.to_string_lossy().to_string())
}

pub fn fence_folder(store: &Path, title: &str) -> PathBuf {
    store.join(folder_name(title))
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

    fn diag(h: HWND) -> String {
        unsafe {
            let owner = GetWindow(h, GW_OWNER).map(|o| o.0 as isize).unwrap_or(0);
            let mut cloaked: u32 = 0;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut std::ffi::c_void, 4);
            format!(
                "dueño={} estilo={:#x} estiloEx={:#x} oculta_por_dwm={} primer_plano={}",
                owner,
                GetWindowLongW(h, GWL_STYLE) as u32,
                GetWindowLongW(h, GWL_EXSTYLE) as u32,
                cloaked,
                GetForegroundWindow() == h
            )
        }
    }

    /// Sube las cercas al primer plano. Si una se resiste (ya era «siempre encima» pero queda bajo el
    /// escritorio) se prueban métodos cada vez más insistentes. Cada elemento: (ventana, intento).
    fn raise_all(app: &AppHandle, hs: Vec<(isize, u32)>) {
        if hs.is_empty() {
            return;
        }
        let hosts_now = hosts();
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || unsafe {
            for (h, attempt) in hs {
                let h = HWND(h as *mut _);
                if attempt >= 2 && attempt % 10 == 2 {
                    log(&app2, format!("cerca resistente (intento {attempt}): {}", diag(h)));
                }
                match attempt {
                    0 | 1 => {
                        if is_top(h) {
                            let _ = SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, FLAGS);
                        }
                        if SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS).is_err() {
                            log(&app2, format!("SetWindowPos falló en {:?}: error {}", h.0, GetLastError().0));
                        }
                    }
                    2 | 3 => {
                        let _ = SetWindowPos(h, HWND_TOP, 0, 0, 0, 0, FLAGS);
                        let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
                    }
                    4 | 5 => {
                        let _ = BringWindowToTop(h);
                        let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
                    }
                    n => {
                        // último recurso: se oculta y se vuelve a mostrar para que Windows la coloque de nuevo
                        if n % 8 == 6 {
                            let _ = ShowWindow(h, SW_HIDE);
                            let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                        }
                        let _ = SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, FLAGS);
                        let _ = SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, FLAGS);
                        // y, si aún hay un escritorio encima, justo por encima de él
                        for host in hosts_now.iter() {
                            let above = GetWindow(HWND(*host as *mut _), GW_HWNDPREV).unwrap_or_default();
                            if above != h {
                                let after = if above.0.is_null() { HWND_TOP } else { above };
                                let _ = SetWindowPos(h, after, 0, 0, 0, 0, FLAGS);
                            }
                            break;
                        }
                    }
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
            let mut attempts = std::collections::HashMap::<String, u32>::new();
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
                        attempts.clear();
                        log(&app, format!("escritorio encima; {}", states(&app)));
                    }
                    if hidden_by_user {
                        continue;
                    }
                    let mut todo = vec![];
                    for w in crate::fence_windows(&app) {
                        if let Some(h) = raw(&w) {
                            if !is_top(h) || host_above(h, &hs) {
                                let n = attempts.entry(w.label().to_string()).or_insert(0);
                                todo.push((h.0 as isize, *n));
                                *n += 1;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;

    #[test]
    fn mueve_a_la_carpeta_de_la_cerca_y_devuelve() {
        let base = std::env::temp_dir().join(format!("mc-test-{}", std::process::id()));
        let desktop = base.join("Desktop");
        let store_dir = base.join("Mis Cercas");
        std::fs::create_dir_all(&desktop).unwrap();
        std::fs::write(desktop.join("a.txt"), "x").unwrap();
        std::fs::write(desktop.join("b.txt"), "y").unwrap();
        let mut data = store::normalize(&serde_json::Value::Null);
        let mut f = store::sanitize_fence(&serde_json::json!({ "title": "Juegos: *" }));
        f.items = vec![
            store::Item { p: desktop.join("a.txt").to_string_lossy().to_string(), n: None },
            store::Item { p: desktop.join("b.txt").to_string_lossy().to_string(), n: None },
        ];
        let id = f.id.clone();
        data.fences = vec![f];
        let changed = adopt(&mut data, Some(desktop.clone()), &store_dir, None);
        assert_eq!(changed, vec![id]);
        let p = data.fences[0].items[0].p.clone();
        assert!(Path::new(&p).exists() && in_store(&p, &store_dir));
        assert!(!desktop.join("a.txt").exists());
        assert!(p.contains("Juegos_ _"), "{p}");
        let back = give_back(&p, &store_dir, Some(desktop.clone())).unwrap();
        assert!(Path::new(&back).exists() && desktop.join("a.txt").exists());
        // un nombre repetido no pisa nada
        std::fs::write(desktop.join("b.txt"), "z").unwrap();
        let q = data.fences[0].items[1].p.clone();
        let b2 = give_back(&q, &store_dir, Some(desktop.clone())).unwrap();
        assert!(b2.contains("b (2).txt"), "{b2}");
        let _ = std::fs::remove_dir_all(&base);
    }
}
