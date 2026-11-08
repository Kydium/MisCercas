mod align;
mod desk;
mod icons;
mod store;
mod sys;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Estado de ejecución de cada cerca (no se guarda).
pub struct FState {
    hover: bool,
    last_inside: Instant,
    menu_open: bool,
    collapsed: bool,
    ignore_until: Instant,
    last_event: Option<Instant>,
    prev: Option<align::B>,
}

impl FState {
    fn new(collapsed: bool) -> Self {
        let now = Instant::now();
        FState { hover: false, last_inside: now, menu_open: false, collapsed, ignore_until: now, last_event: None, prev: None }
    }
}

pub struct AppState {
    dir: PathBuf,
    desktop: Option<PathBuf>,
    data: Mutex<store::Data>,
    dirty: AtomicBool,
    icons: Mutex<HashMap<String, Option<String>>>,
    pub(crate) all_hidden: AtomicBool,
    fs: Mutex<HashMap<String, FState>>,
}

impl AppState {
    fn touch(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }
    fn flush(&self) {
        if self.dirty.swap(false, Ordering::SeqCst) {
            let copy = {
                let mut d = self.data.lock().unwrap();
                desk::sync(&mut d, self.desktop.clone());
                d.clone()
            };
            if let Err(e) = store::save(&self.dir, &copy) {
                eprintln!("No se pudo guardar la configuración: {e}");
            }
        }
    }
}

fn key(p: &str) -> String {
    if cfg!(windows) { p.replace('/', "\\").to_lowercase() } else { p.to_string() }
}

fn bg<F: FnOnce() + Send + 'static>(f: F) {
    std::thread::spawn(f);
}

/* ---------- ventanas ---------- */
fn label(id: &str) -> String {
    format!("fence-{id}")
}
fn id_of(label: &str) -> String {
    label.trim_start_matches("fence-").to_string()
}

pub(crate) fn fence_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(k, _)| k.starts_with("fence-")).map(|(_, w)| w).collect()
}

fn fence_of(app: &AppHandle, id: &str) -> Option<store::Fence> {
    app.state::<AppState>().data.lock().unwrap().fences.iter().find(|f| f.id == id).cloned()
}

fn with_fs<R>(app: &AppHandle, id: &str, f: impl FnOnce(&mut FState) -> R) -> R {
    let st = app.state::<AppState>();
    let collapsed = fence_of(app, id).map(|f| f.rolled).unwrap_or(false);
    let mut m = st.fs.lock().unwrap();
    f(m.entry(id.to_string()).or_insert_with(|| FState::new(collapsed)))
}

fn is_collapsed(f: &store::Fence, hover: bool) -> bool {
    if f.auto_roll { !hover } else { f.rolled }
}

fn win_box(w: &WebviewWindow) -> Option<align::B> {
    let sc = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?.to_logical::<f64>(sc);
    let s = w.outer_size().ok()?.to_logical::<f64>(sc);
    Some(align::B { id: id_of(w.label()), x: p.x.round() as i32, y: p.y.round() as i32, w: s.width.round() as i32, h: s.height.round() as i32 })
}

fn monitor_key(w: &WebviewWindow) -> Option<(i32, i32)> {
    w.current_monitor().ok().flatten().map(|m| (m.position().x, m.position().y))
}

fn work_area(w: &WebviewWindow) -> align::Area {
    if let Ok(Some(m)) = w.current_monitor() {
        let sc = m.scale_factor();
        let wa = m.work_area();
        let p = wa.position.to_logical::<f64>(sc);
        let s = wa.size.to_logical::<f64>(sc);
        return align::Area { x: p.x.round() as i32, y: p.y.round() as i32, w: s.width.round() as i32, h: s.height.round() as i32 };
    }
    align::Area { x: 0, y: 0, w: 1920, h: 1040 }
}

/// Ajusta el tamaño (y la posición si se indica) de la ventana a los datos guardados de la cerca.
fn relayout(app: &AppHandle, id: &str, with_pos: bool) {
    let Some(f) = fence_of(app, id) else { return };
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    let collapsed = with_fs(app, id, |s| {
        let c = is_collapsed(&f, s.hover);
        s.collapsed = c;
        s.ignore_until = Instant::now() + Duration::from_millis(600);
        c
    });
    let h = if collapsed { store::HEADER_H } else { f.h };
    let _ = win.set_min_size(Some(LogicalSize::new(store::MIN_W as f64, if collapsed { store::HEADER_H } else { store::MIN_H } as f64)));
    if with_pos {
        let _ = win.set_position(LogicalPosition::new(f.x as f64, f.y as f64));
    }
    let _ = win.set_size(LogicalSize::new(f.w as f64, h as f64));
    let _ = app.emit("layout", json!({ "id": id, "collapsed": collapsed }));
}

fn geom_changed(app: &AppHandle, id: &str) {
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    let Some(f) = fence_of(app, id) else { return };
    let ignored = with_fs(app, id, |s| Instant::now() < s.ignore_until);
    if ignored {
        return;
    }
    let Some(b) = win_box(&win) else { return };
    if f.locked && (b.x != f.x || b.y != f.y || b.w != f.w) {
        // bloqueada: vuelve a su sitio
        with_fs(app, id, |s| s.ignore_until = Instant::now() + Duration::from_millis(400));
        let h = if with_fs(app, id, |s| s.collapsed) { store::HEADER_H } else { f.h };
        let _ = win.set_position(LogicalPosition::new(f.x as f64, f.y as f64));
        let _ = win.set_size(LogicalSize::new(f.w as f64, h as f64));
        return;
    }
    let state = app.state::<AppState>();
    let collapsed = with_fs(app, id, |s| {
        if s.last_event.is_none() {
            s.prev = Some(align::B { id: id.into(), x: f.x, y: f.y, w: f.w, h: if s.collapsed { store::HEADER_H } else { f.h } });
        }
        s.last_event = Some(Instant::now());
        s.collapsed
    });
    {
        let mut d = state.data.lock().unwrap();
        if let Some(f) = d.fences.iter_mut().find(|f| f.id == id) {
            f.x = b.x;
            f.y = b.y;
            f.w = b.w.max(store::MIN_W);
            if !collapsed {
                f.h = b.h.max(store::MIN_H);
            }
        }
    }
    state.touch();
}

fn neighbours(app: &AppHandle, id: &str, win: &WebviewWindow) -> Vec<align::B> {
    let mk = monitor_key(win);
    fence_windows(app)
        .into_iter()
        .filter(|w| id_of(w.label()) != id && w.is_visible().unwrap_or(false) && monitor_key(w) == mk)
        .filter_map(|w| win_box(&w))
        .collect()
}

/// Al terminar de mover o redimensionar: si el imán está activo, alinea con las vecinas.
fn settle(app: &AppHandle, id: &str) {
    let (prev, collapsed) = with_fs(app, id, |s| {
        s.last_event = None;
        (s.prev.take(), s.collapsed)
    });
    let Some(f) = fence_of(app, id) else { return };
    let snap_on = app.state::<AppState>().data.lock().unwrap().settings.snap;
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    if !snap_on || f.locked {
        return;
    }
    let Some(cur) = win_box(&win) else { return };
    let others = neighbours(app, id, &win);
    let to = align::snap(&cur, prev.as_ref(), &others, work_area(&win), collapsed);
    if to != cur {
        let w = to.w.max(store::MIN_W);
        let h = if collapsed { store::HEADER_H } else { to.h.max(store::MIN_H) };
        with_fs(app, id, |s| s.ignore_until = Instant::now() + Duration::from_millis(600));
        let _ = win.set_position(LogicalPosition::new(to.x as f64, to.y as f64));
        let _ = win.set_size(LogicalSize::new(w as f64, h as f64));
        let state = app.state::<AppState>();
        {
            let mut d = state.data.lock().unwrap();
            if let Some(f) = d.fences.iter_mut().find(|f| f.id == id) {
                f.x = to.x;
                f.y = to.y;
                f.w = w;
                if !collapsed {
                    f.h = h;
                }
            }
        }
        state.touch();
    }
}

fn tick(app: &AppHandle) {
    // enrollar al salir el ratón
    let cur = app.cursor_position().ok();
    let autos: Vec<String> = app.state::<AppState>().data.lock().unwrap().fences.iter().filter(|f| f.auto_roll).map(|f| f.id.clone()).collect();
    for id in autos {
        let inside = match (cur, app.get_webview_window(&label(&id))) {
            (Some(c), Some(w)) if w.is_visible().unwrap_or(false) => match (w.outer_position(), w.outer_size()) {
                (Ok(p), Ok(s)) => c.x >= p.x as f64 && c.x < (p.x + s.width as i32) as f64 && c.y >= p.y as f64 && c.y < (p.y + s.height as i32) as f64,
                _ => false,
            },
            _ => false,
        };
        let change = with_fs(app, &id, |s| {
            if inside {
                s.last_inside = Instant::now();
                if !s.hover {
                    s.hover = true;
                    return true;
                }
            } else if s.hover && !s.menu_open && s.last_inside.elapsed() > Duration::from_millis(450) {
                s.hover = false;
                return true;
            }
            false
        });
        if change {
            relayout(app, &id, false);
        }
    }
    // fin de un movimiento o cambio de tamaño
    let due: Vec<String> = {
        let st = app.state::<AppState>();
        let m = st.fs.lock().unwrap();
        m.iter().filter(|(_, s)| s.last_event.map(|t| t.elapsed() > Duration::from_millis(280)).unwrap_or(false)).map(|(k, _)| k.clone()).collect()
    };
    if !due.is_empty() && !sys::mouse_down() {
        for id in due {
            settle(app, &id);
        }
    }
}

fn apply_topmost(app: &AppHandle) {
    let st = app.state::<AppState>();
    let (keep, pins): (bool, HashMap<String, bool>) = {
        let d = st.data.lock().unwrap();
        (d.settings.keep_on_top, d.fences.iter().map(|f| (f.id.clone(), f.pinned)).collect())
    };
    for w in fence_windows(app) {
        let pin = pins.get(&id_of(w.label())).copied().unwrap_or(false);
        let _ = w.set_always_on_top(pin || keep);
    }
}

fn create_fence_window(app: &AppHandle, f: &store::Fence, keep_on_top: bool) {
    let name = label(&f.id);
    if app.get_webview_window(&name).is_some() {
        return;
    }
    let collapsed = is_collapsed(f, false);
    {
        let st = app.state::<AppState>();
        st.fs.lock().unwrap().insert(f.id.clone(), FState::new(collapsed));
    }
    let h = if collapsed { store::HEADER_H } else { f.h };
    let url = WebviewUrl::App(format!("fence.html?id={}", f.id).into());
    let built = WebviewWindowBuilder::new(app, &name, url)
        .title(&f.title)
        .inner_size(f.w as f64, h as f64)
        .position(f.x as f64, f.y as f64)
        .min_inner_size(store::MIN_W as f64, store::HEADER_H as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(!f.locked)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(f.pinned || keep_on_top)
        .focused(false)
        .build();
    match built {
        Ok(win) => {
            let app2 = app.clone();
            let id = f.id.clone();
            win.on_window_event(move |ev| {
                if matches!(ev, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                    geom_changed(&app2, &id);
                }
            });
        }
        Err(e) => eprintln!("No se pudo crear la cerca {}: {e}", f.id),
    }
}

fn toggle_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    let hide = !state.all_hidden.load(Ordering::SeqCst);
    state.all_hidden.store(hide, Ordering::SeqCst);
    for w in fence_windows(app) {
        let _ = if hide { w.hide() } else { w.show() };
    }
}

/* ---------- crear, duplicar y borrar cercas ---------- */
fn next_position(app: &AppHandle, near: Option<&str>) -> (i32, i32) {
    let st = app.state::<AppState>();
    let d = st.data.lock().unwrap();
    if let Some(n) = near.and_then(|id| d.fences.iter().find(|f| f.id == id)) {
        return (n.x + 36, n.y + 36);
    }
    let k = d.fences.len() as i32 % 8;
    (60 + k * 36, 60 + k * 36)
}

fn template(app: &AppHandle, name: &str, dir: Option<PathBuf>) -> Value {
    let p = app.path();
    let s = |r: tauri::Result<PathBuf>| r.map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    match name {
        "desktop" => {
            let public = std::env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".into());
            let pubd = PathBuf::from(public).join("Desktop").to_string_lossy().to_string();
            let mut dirs = vec![s(p.desktop_dir())];
            if cfg!(windows) {
                dirs.push(pubd);
            }
            json!({ "title": "Escritorio", "w": 420, "h": 320, "portal": { "dirs": dirs } })
        }
        "downloads" => json!({ "title": "Descargas", "w": 380, "h": 300, "portal": { "dirs": [s(p.download_dir())], "sort": "date" } }),
        "documents" => json!({ "title": "Documentos", "w": 380, "h": 300, "portal": { "dirs": [s(p.document_dir())] } }),
        "pictures" => json!({ "title": "Imágenes", "w": 380, "h": 300, "portal": { "dirs": [s(p.picture_dir())], "filter": "images" } }),
        "folder" => {
            let d = dir.unwrap_or_default();
            let t = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Carpeta".into());
            json!({ "title": t, "w": 380, "h": 300, "portal": { "dirs": [d.to_string_lossy()] } })
        }
        _ => json!({}),
    }
}

fn add_fence(app: &AppHandle, near: Option<&str>, tpl: &str, dir: Option<PathBuf>) {
    let (x, y) = next_position(app, near);
    let mut v = template(app, tpl, dir);
    if v.get("title").is_none() {
        v["title"] = json!("Nueva cerca");
    }
    v["x"] = json!(x);
    v["y"] = json!(y);
    let state = app.state::<AppState>();
    let (fence, keep) = {
        let mut d = state.data.lock().unwrap();
        v["autoRoll"] = json!(d.settings.default_auto_roll);
        let f = store::sanitize_fence(&v);
        d.fences.push(f.clone());
        (f, d.settings.keep_on_top)
    };
    state.touch();
    if state.all_hidden.load(Ordering::SeqCst) {
        toggle_all(app);
    }
    create_fence_window(app, &fence, keep);
}

fn duplicate_fence(app: &AppHandle, id: &str) {
    let Some(f) = fence_of(app, id) else { return };
    let (x, y) = next_position(app, Some(id));
    let mut v = serde_json::to_value(&f).unwrap_or(Value::Null);
    v["id"] = Value::Null;
    v["title"] = json!(format!("{} (copia)", f.title));
    v["x"] = json!(x);
    v["y"] = json!(y);
    let state = app.state::<AppState>();
    let (copy, keep) = {
        let mut d = state.data.lock().unwrap();
        let c = store::sanitize_fence(&v);
        d.fences.push(c.clone());
        (c, d.settings.keep_on_top)
    };
    state.touch();
    create_fence_window(app, &copy, keep);
}

fn delete_fence(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    state.data.lock().unwrap().fences.retain(|f| f.id != id);
    state.fs.lock().unwrap().remove(id);
    state.touch();
    if let Some(w) = app.get_webview_window(&label(id)) {
        let _ = w.destroy();
    }
}

/// Cambia datos de una cerca (desde el menú o desde la propia cerca) y aplica lo que haga falta.
fn patch_fence(app: &AppHandle, id: &str, patch: &Value, notify: bool) -> bool {
    const ALLOWED: [&str; 10] = ["title", "items", "sort", "view", "color", "locked", "pinned", "autoRoll", "rolled", "portal"];
    let state = app.state::<AppState>();
    let (old, new) = {
        let mut d = state.data.lock().unwrap();
        let Some(f) = d.fences.iter_mut().find(|f| f.id == id) else { return false };
        let old = f.clone();
        let mut v = serde_json::to_value(&old).unwrap_or(Value::Null);
        if let Some(p) = patch.as_object() {
            for (k, val) in p {
                if ALLOWED.contains(&k.as_str()) {
                    v[k] = val.clone();
                }
            }
        }
        let mut nf = store::sanitize_fence(&v);
        nf.id = old.id.clone();
        *f = nf.clone();
        (old, nf)
    };
    state.touch();
    let keep = state.data.lock().unwrap().settings.keep_on_top;
    if let Some(win) = app.get_webview_window(&label(id)) {
        if old.pinned != new.pinned {
            let _ = win.set_always_on_top(new.pinned || keep);
        }
        if old.locked != new.locked {
            let _ = win.set_resizable(!new.locked);
        }
        if old.title != new.title {
            let _ = win.set_title(&new.title);
        }
    }
    if old.rolled != new.rolled || old.auto_roll != new.auto_roll {
        relayout(app, id, false);
    }
    if notify {
        let _ = app.emit("reload", json!({ "id": id }));
    }
    true
}

/* ---------- alinear, igualar y ordenar ---------- */
fn peers(app: &AppHandle, id: &str) -> Vec<align::B> {
    let Some(win) = app.get_webview_window(&label(id)) else { return vec![] };
    let mk = monitor_key(&win);
    let wins: Vec<String> = fence_windows(app)
        .into_iter()
        .filter(|w| w.is_visible().unwrap_or(false) && monitor_key(w) == mk)
        .map(|w| id_of(w.label()))
        .collect();
    let d = app.state::<AppState>();
    let d = d.data.lock().unwrap();
    d.fences.iter().filter(|f| wins.contains(&f.id)).map(|f| align::B { id: f.id.clone(), x: f.x, y: f.y, w: f.w, h: f.h }).collect()
}

fn apply_boxes(app: &AppHandle, boxes: Vec<align::B>) {
    let state = app.state::<AppState>();
    let mut changed = vec![];
    {
        let mut d = state.data.lock().unwrap();
        for b in boxes {
            if let Some(f) = d.fences.iter_mut().find(|f| f.id == b.id) {
                if f.locked {
                    continue;
                }
                f.x = b.x;
                f.y = b.y;
                f.w = b.w.max(store::MIN_W);
                f.h = b.h.max(store::MIN_H);
                changed.push(b.id);
            }
        }
    }
    state.touch();
    for id in changed {
        relayout(app, &id, true);
    }
}

fn align_to(app: &AppHandle, id: &str, name: &str) {
    let list = peers(app, id);
    let Some(r) = list.iter().find(|b| b.id == id).cloned() else { return };
    if let Some(out) = align::op(name, &list, &r) {
        apply_boxes(app, out.into_iter().filter(|b| b.id != id).collect());
    }
}

fn tidy(app: &AppHandle, id: &str) {
    let list = peers(app, id);
    if list.is_empty() {
        return;
    }
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    let wa = work_area(&win);
    let r = align::common_size(&list);
    apply_boxes(app, align::tidy_grid(&list, &r, wa));
}

/* ---------- configuración ---------- */
fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Configuración · Mis Cercas")
        .inner_size(580.0, 740.0)
        .min_inner_size(480.0, 520.0)
        .center()
        .build();
    if let Err(e) = built {
        eprintln!("No se pudo abrir la configuración: {e}");
    }
}

fn settings_payload(app: &AppHandle, state: &AppState) -> Value {
    let d = state.data.lock().unwrap();
    json!({
        "settings": d.settings,
        "autoStart": sys::autostart_get(),
        "version": app.package_info().version.to_string(),
        "dataDir": state.dir.to_string_lossy(),
        "hotkey": d.settings.hotkey,
    })
}

fn set_hotkey(app: &AppHandle, new: &str, old: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister(old);
    if let Err(e) = gs.register(new) {
        let _ = gs.register(old);
        return Err(e.to_string());
    }
    Ok(())
}

/// Cierra todas las cercas y las vuelve a crear desde los datos (importar / restablecer).
fn replace_everything(app: &AppHandle, mut data: store::Data) {
    let state = app.state::<AppState>();
    for w in fence_windows(app) {
        let _ = w.destroy();
    }
    std::thread::sleep(Duration::from_millis(400));
    if data.fences.is_empty() {
        data.fences.push(store::sanitize_fence(&json!({ "title": "Mi primera cerca" })));
    }
    {
        let mut d = state.data.lock().unwrap();
        data.hidden = d.hidden.clone(); // lo que ocultamos antes se vuelve a mostrar si ya no corresponde
        *d = data.clone();
    }
    state.fs.lock().unwrap().clear();
    state.touch();
    let keep = data.settings.keep_on_top;
    for f in &data.fences {
        create_fence_window(app, f, keep);
    }
    let _ = app.emit("settings", json!({ "settings": data.settings }));
}

/* ---------- menús contextuales ---------- */
type MI = Box<dyn IsMenuItem<Wry>>;

fn mid(fid: &str, action: &str, arg: &str) -> String {
    format!("cm|{fid}|{action}|{arg}")
}
fn item(app: &AppHandle, id: String, text: &str, enabled: bool) -> MI {
    Box::new(MenuItem::with_id(app, id, text, enabled, None::<&str>).expect("menú"))
}
fn check(app: &AppHandle, id: String, text: &str, on: bool) -> MI {
    Box::new(CheckMenuItem::with_id(app, id, text, true, on, None::<&str>).expect("menú"))
}
fn sep(app: &AppHandle) -> MI {
    Box::new(PredefinedMenuItem::separator(app).expect("menú"))
}
fn sub(app: &AppHandle, text: &str, items: Vec<MI>) -> MI {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Box::new(Submenu::with_items(app, text, true, &refs).expect("menú"))
}
fn menu_of(app: &AppHandle, items: Vec<MI>) -> Menu<Wry> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs).expect("menú")
}

fn popup(app: &AppHandle, id: &str, build: impl FnOnce(&AppHandle) -> Menu<Wry> + Send + 'static) {
    let app2 = app.clone();
    let id = id.to_string();
    let _ = app.run_on_main_thread(move || {
        let menu = build(&app2);
        with_fs(&app2, &id, |s| s.menu_open = true);
        if let Some(w) = app2.get_webview_window(&label(&id)) {
            let _ = w.popup_menu(&menu);
        }
        with_fs(&app2, &id, |s| {
            s.menu_open = false;
            s.last_inside = Instant::now();
        });
    });
}

const COLORS: [(&str, &str); 8] = [
    ("Automático", "none"), ("Azul", "#4d8dff"), ("Verde", "#2fbf71"), ("Violeta", "#8b5cf6"),
    ("Naranja", "#ff8a3d"), ("Rojo", "#ef4b5f"), ("Rosa", "#ec5fa8"), ("Gris", "#8b95a7"),
];
const FILTERS: [(&str, &str); 8] = [
    ("all", "Todo"), ("folders", "Carpetas"), ("shortcuts", "Accesos directos"), ("docs", "Documentos"),
    ("images", "Imágenes"), ("media", "Audio y vídeo"), ("archives", "Comprimidos"), ("apps", "Programas"),
];
const PORTAL_SORTS: [(&str, &str); 4] = [("name", "Nombre"), ("date", "Fecha de modificación"), ("size", "Tamaño"), ("type", "Tipo")];
const FENCE_SORTS: [(&str, &str); 3] = [("manual", "Manual (arrastrar)"), ("name", "Nombre"), ("type", "Tipo")];

fn new_fence_items(app: &AppHandle, id: &str) -> Vec<MI> {
    vec![
        item(app, mid(id, "new", "empty"), "Cerca vacía", true),
        sep(app),
        item(app, mid(id, "new", "desktop"), "Portal: Escritorio", true),
        item(app, mid(id, "new", "downloads"), "Portal: Descargas", true),
        item(app, mid(id, "new", "documents"), "Portal: Documentos", true),
        item(app, mid(id, "new", "pictures"), "Portal: Imágenes", true),
        item(app, mid(id, "new", "folder"), "Portal: elegir carpeta…", true),
    ]
}

fn build_fence_menu(app: &AppHandle, f: &store::Fence, snap: bool) -> Menu<Wry> {
    let id = f.id.as_str();
    let radio = |v: &str, text: &str, on: bool, act: &str| check(app, mid(id, act, v), text, on);
    let mut t: Vec<MI> = vec![
        sub(app, "Nueva cerca", new_fence_items(app, id)),
        sep(app),
        item(app, mid(id, "rename", ""), "Cambiar nombre…", true),
        item(app, mid(id, "roll", ""), if f.rolled { "Desenrollar" } else { "Enrollar" }, !f.auto_roll),
        check(app, mid(id, "autoroll", ""), "Enrollar al salir el ratón", f.auto_roll),
        sub(app, "Alinear y ordenar", vec![
            item(app, mid(id, "align", "size"), "Igualar tamaño de todas a esta", true),
            item(app, mid(id, "align", "width"), "Igualar solo el ancho", true),
            item(app, mid(id, "align", "height"), "Igualar solo el alto", true),
            sep(app),
            item(app, mid(id, "align", "left"), "Alinear las demás por la izquierda", true),
            item(app, mid(id, "align", "top"), "Alinear las demás por arriba", true),
            item(app, mid(id, "align", "right"), "Alinear las demás por la derecha", true),
            item(app, mid(id, "align", "bottom"), "Alinear las demás por abajo", true),
            sep(app),
            item(app, mid(id, "align", "column"), "Apilar las demás en columna debajo de esta", true),
            item(app, mid(id, "tidy", ""), "Ordenar todas en cuadrícula", true),
            sep(app),
            check(app, mid(id, "snap", ""), "Imán entre cercas", snap),
        ]),
        check(app, mid(id, "locked", ""), "Bloquear posición y tamaño", f.locked),
        check(app, mid(id, "pinned", ""), "Mantener encima de otras ventanas", f.pinned),
        sep(app),
        sub(app, "Color", COLORS.iter().map(|(n, c)| radio(c, n, f.color.as_deref().unwrap_or("none") == *c, "color")).collect()),
        sub(app, "Vista", vec![radio("grid", "Cuadrícula", f.view == "grid", "view"), radio("list", "Lista", f.view == "list", "view")]),
    ];
    if let Some(p) = &f.portal {
        t.push(sub(app, "Ordenar por", PORTAL_SORTS.iter().map(|(k, n)| radio(k, n, p.sort == *k, "psort")).collect()));
        t.push(sub(app, "Mostrar", FILTERS.iter().map(|(k, n)| radio(k, n, p.filter == *k, "pfilter")).collect()));
        t.push(check(app, mid(id, "phidden", ""), "Mostrar archivos ocultos", p.show_hidden));
        t.push(item(app, mid(id, "openfolder", ""), "Abrir carpeta", true));
        t.push(item(app, mid(id, "unportal", ""), "Quitar portal (volver a cerca normal)", true));
    } else {
        t.push(sub(app, "Ordenar por", FENCE_SORTS.iter().map(|(k, n)| radio(k, n, f.sort == *k, "sort")).collect()));
        t.push(item(app, mid(id, "toportal", ""), "Convertir en portal de carpeta…", true));
        t.push(item(app, mid(id, "vaciar", ""), "Vaciar cerca", !f.items.is_empty()));
    }
    t.push(sep(app));
    t.push(item(app, mid(id, "dup", ""), "Duplicar cerca", true));
    t.push(item(app, mid(id, "del", ""), "Eliminar cerca…", true));
    t.push(sep(app));
    t.push(item(app, mid(id, "settings", ""), "Configuración…", true));
    menu_of(app, t)
}

fn toggle_of(f: &store::Fence, k: &str) -> Value {
    json!(match k {
        "locked" => !f.locked,
        "pinned" => !f.pinned,
        "autoRoll" => !f.auto_roll,
        "rolled" => !f.rolled,
        _ => false,
    })
}

fn move_item(app: &AppHandle, src: &str, target: Option<&str>, path: &str) -> Option<String> {
    let state = app.state::<AppState>();
    let k = key(path);
    let result;
    {
        let mut d = state.data.lock().unwrap();
        let hide = d.settings.hide_desktop;
        let dirs = desk::desktop_dirs(state.desktop.clone());
        let s = d.fences.iter().position(|f| f.id == src)?;
        if d.fences[s].portal.is_some() {
            return None;
        }
        let i = d.fences[s].items.iter().position(|it| key(&it.p) == k)?;
        if let Some(t) = target {
            let ti = d.fences.iter().position(|f| f.id == t)?;
            if d.fences[ti].portal.is_some() || ti == s {
                return None;
            }
            let it = d.fences[s].items.remove(i);
            if !d.fences[ti].items.iter().any(|x| key(&x.p) == k) {
                d.fences[ti].items.push(it);
            }
            result = "moved".to_string();
        } else {
            d.fences[s].items.remove(i);
            result = if hide && desk::in_desktop(path, &dirs) { "desktop".into() } else { "removed".to_string() };
        }
    }
    state.touch();
    let _ = app.emit("reload", json!({ "id": src }));
    if let Some(t) = target {
        let _ = app.emit("reload", json!({ "id": t }));
    }
    Some(result)
}

fn fence_action(app: &AppHandle, id: &str, action: &str, arg: &str) {
    let Some(f) = fence_of(app, id) else { return };
    let st = app.state::<AppState>();
    match action {
        "new" => match arg {
            "folder" => {
                if let Some(d) = sys::pick_folder() {
                    add_fence(app, Some(id), "folder", Some(d));
                }
            }
            t => add_fence(app, Some(id), if t == "empty" { "" } else { t }, None),
        },
        "rename" => {
            if let Some(w) = app.get_webview_window(&label(id)) {
                let _ = w.set_focus();
            }
            let _ = app.emit("rename-title", json!({ "id": id }));
        }
        "roll" => {
            patch_fence(app, id, &json!({ "rolled": toggle_of(&f, "rolled") }), true);
        }
        "autoroll" => {
            patch_fence(app, id, &json!({ "autoRoll": toggle_of(&f, "autoRoll") }), true);
        }
        "locked" => {
            patch_fence(app, id, &json!({ "locked": toggle_of(&f, "locked") }), true);
        }
        "pinned" => {
            patch_fence(app, id, &json!({ "pinned": toggle_of(&f, "pinned") }), true);
        }
        "align" => align_to(app, id, arg),
        "tidy" => tidy(app, id),
        "snap" => {
            let s = {
                let mut d = st.data.lock().unwrap();
                d.settings.snap = !d.settings.snap;
                d.settings.clone()
            };
            st.touch();
            let _ = app.emit("settings", json!({ "settings": s }));
        }
        "color" => {
            patch_fence(app, id, &json!({ "color": if arg == "none" { Value::Null } else { json!(arg) } }), true);
        }
        "view" => {
            patch_fence(app, id, &json!({ "view": arg }), true);
        }
        "sort" => {
            patch_fence(app, id, &json!({ "sort": arg }), true);
        }
        "psort" | "pfilter" | "phidden" => {
            let mut p = serde_json::to_value(&f.portal).unwrap_or(Value::Null);
            if p.is_object() {
                match action {
                    "psort" => p["sort"] = json!(arg),
                    "pfilter" => p["filter"] = json!(arg),
                    _ => p["showHidden"] = json!(!f.portal.as_ref().map(|x| x.show_hidden).unwrap_or(false)),
                }
                patch_fence(app, id, &json!({ "portal": p }), true);
            }
        }
        "openfolder" => {
            if let Some(d) = f.portal.as_ref().and_then(|p| p.dirs.first()) {
                icons::open(d);
            }
        }
        "unportal" => {
            patch_fence(app, id, &json!({ "portal": Value::Null }), true);
        }
        "toportal" => {
            if let Some(d) = sys::pick_folder() {
                patch_fence(app, id, &json!({ "portal": { "dirs": [d.to_string_lossy()] } }), true);
            }
        }
        "vaciar" => {
            patch_fence(app, id, &json!({ "items": [] }), true);
        }
        "dup" => duplicate_fence(app, id),
        "del" => {
            if sys::confirm("Eliminar cerca", &format!("¿Eliminar la cerca «{}»?", f.title), "Tus archivos no se borran; solo se elimina la cerca.") {
                delete_fence(app, id);
            }
        }
        "settings" => open_settings(app),
        "moveto" => {
            if let Some((t, p)) = arg.split_once('|') {
                move_item(app, id, Some(t), p);
            }
        }
        "show" => sys::show_in_folder(arg),
        "i-open" | "i-rename" | "i-restore" | "i-remove" | "i-copy" => {
            let _ = app.emit("item-action", json!({ "id": id, "action": &action[2..], "path": arg }));
        }
        _ => {}
    }
}

fn handle_menu(app: &AppHandle, id: &str) {
    let mut it = id.splitn(4, '|');
    let (_, Some(fid), Some(action), Some(arg)) = (it.next(), it.next(), it.next(), it.next()) else { return };
    let (app, fid, action, arg) = (app.clone(), fid.to_string(), action.to_string(), arg.to_string());
    bg(move || fence_action(&app, &fid, &action, &arg));
}

/* ---------- comandos (los que usa la interfaz) ---------- */
#[tauri::command]
fn state_get(app: AppHandle, state: State<AppState>, id: String) -> Option<Value> {
    let (f, settings) = {
        let d = state.data.lock().unwrap();
        (d.fences.iter().find(|f| f.id == id)?.clone(), d.settings.clone())
    };
    let collapsed = with_fs(&app, &id, |s| s.collapsed);
    Some(json!({ "fence": f, "settings": settings, "collapsed": collapsed }))
}

#[tauri::command]
fn settings_get(app: AppHandle, state: State<AppState>) -> Value {
    settings_payload(&app, &state)
}

#[tauri::command]
fn settings_set(app: AppHandle, state: State<AppState>, patch: Value) -> Value {
    let mut error = Value::Null;
    let mut next = {
        let d = state.data.lock().unwrap();
        serde_json::to_value(&d.settings).unwrap_or(Value::Null)
    };
    let old_hotkey = state.data.lock().unwrap().settings.hotkey.clone();
    if let (Some(cur), Some(p)) = (next.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            if k == "autoStart" {
                if let Some(on) = v.as_bool() {
                    if !sys::autostart_set(on) {
                        error = json!("No se pudo cambiar el inicio con Windows.");
                    }
                }
                continue;
            }
            if k == "hotkey" {
                if let Some(h) = v.as_str() {
                    if h != old_hotkey {
                        match set_hotkey(&app, h, &old_hotkey) {
                            Ok(()) => {
                                cur.insert(k.clone(), v.clone());
                            }
                            Err(_) => error = json!("No se pudo usar ese atajo (puede que otra aplicación ya lo use)."),
                        }
                    }
                }
                continue;
            }
            cur.insert(k.clone(), v.clone());
        }
    }
    let settings = store::sanitize_settings(&next);
    {
        state.data.lock().unwrap().settings = settings.clone();
    }
    state.touch();
    apply_topmost(&app);
    let _ = app.emit("settings", json!({ "settings": settings }));
    let mut out = settings_payload(&app, &state);
    out["error"] = error;
    out
}

#[tauri::command]
fn fence_patch(app: AppHandle, id: String, patch: Value) -> bool {
    patch_fence(&app, &id, &patch, false)
}

#[tauri::command]
fn items_info(paths: Vec<String>) -> Vec<Value> {
    paths
        .iter()
        .take(600)
        .map(|p| match std::fs::metadata(p) {
            Ok(m) => json!({ "exists": true, "isDir": m.is_dir() }),
            Err(_) => json!({ "exists": false, "isDir": false }),
        })
        .collect()
}

#[tauri::command]
async fn icon_get(state: State<'_, AppState>, path: String, size: Option<i64>, is_dir: Option<bool>) -> Result<Option<String>, String> {
    let _ = size;
    let k = key(&path);
    if let Some(hit) = state.icons.lock().unwrap().get(&k) {
        return Ok(hit.clone());
    }
    let dir = is_dir.unwrap_or(false);
    let p = path.clone();
    let got = tauri::async_runtime::spawn_blocking(move || icons::get(&p, dir)).await.map_err(|e| e.to_string())?;
    state.icons.lock().unwrap().insert(k, got.clone());
    Ok(got)
}

#[tauri::command]
fn item_open(path: String) -> String {
    if path.is_empty() || icons::open(&path) { String::new() } else { "No se pudo abrir".into() }
}

#[tauri::command]
fn portal_list(state: State<AppState>, id: String) -> Value {
    let d = state.data.lock().unwrap();
    let Some(p) = d.fences.iter().find(|f| f.id == id).and_then(|f| f.portal.clone()) else {
        return json!({ "entries": [], "reachable": 0, "total": 0 });
    };
    let mut entries: Vec<(String, bool)> = Vec::new();
    let mut reachable = 0;
    for dir in &p.dirs {
        if let Ok(rd) = std::fs::read_dir(dir) {
            reachable += 1;
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !p.show_hidden && name.starts_with('.') {
                    continue;
                }
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                entries.push((e.path().to_string_lossy().to_string(), is_dir));
            }
        }
    }
    entries.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    let list: Vec<Value> = entries
        .iter()
        .map(|(path, is_dir)| {
            let label = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            json!({ "path": path, "label": label, "isDir": is_dir })
        })
        .collect();
    json!({ "entries": list, "reachable": reachable, "total": p.dirs.len() })
}

#[tauri::command]
fn item_add(app: AppHandle, state: State<AppState>, id: String, paths: Vec<String>, index: Option<usize>) -> usize {
    let added = {
        let mut d = state.data.lock().unwrap();
        let Some(f) = d.fences.iter_mut().find(|f| f.id == id) else { return 0 };
        if f.portal.is_some() {
            return 0;
        }
        let mut have: std::collections::HashSet<String> = f.items.iter().map(|i| key(&i.p)).collect();
        let fresh: Vec<store::Item> = paths
            .into_iter()
            .filter(|p| !p.is_empty() && have.insert(key(p)))
            .map(|p| store::Item { p, n: None })
            .collect();
        let n = fresh.len();
        let at = index.map(|i| i.min(f.items.len())).unwrap_or(f.items.len());
        f.items.splice(at..at, fresh);
        n
    };
    if added > 0 {
        state.touch();
        let _ = app.emit("reload", json!({ "id": id }));
    }
    added
}

#[tauri::command]
async fn app_action(app: AppHandle, id: String, name: String) -> Result<(), ()> {
    match name.as_str() {
        "settings" => open_settings(&app),
        "newFence" => add_fence(&app, Some(&id), "", None),
        "toggleAll" => toggle_all(&app),
        "toggleRoll" => {
            if let Some(f) = fence_of(&app, &id) {
                if !f.auto_roll {
                    patch_fence(&app, &id, &json!({ "rolled": !f.rolled }), true);
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
async fn data_action(app: AppHandle, name: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Value {
        let state = app.state::<AppState>();
        match name.as_str() {
            "openFolder" | "openLog" => {
                icons::open(&state.dir.to_string_lossy());
                json!({ "ok": true })
            }
            "export" => {
                let Some(p) = sys::save_json("mis-cercas-config.json") else { return json!({ "ok": false, "canceled": true }) };
                let data = state.data.lock().unwrap().clone();
                match serde_json::to_string_pretty(&data).map_err(|e| e.to_string()).and_then(|t| std::fs::write(&p, t).map_err(|e| e.to_string())) {
                    Ok(()) => json!({ "ok": true }),
                    Err(_) => json!({ "ok": false, "error": "No se pudo guardar el archivo." }),
                }
            }
            "import" => {
                let Some(p) = sys::open_json() else { return json!({ "ok": false, "canceled": true }) };
                let Some(raw) = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
                    return json!({ "ok": false, "error": "El archivo no es una configuración válida." });
                };
                if !sys::confirm("Mis Cercas", "¿Reemplazar tus cercas actuales?", "Se sustituirán por las del archivo importado.") {
                    return json!({ "ok": false, "canceled": true });
                }
                replace_everything(&app, store::normalize(&raw));
                json!({ "ok": true })
            }
            "reset" => {
                if !sys::confirm("Mis Cercas", "¿Restablecer Mis Cercas?", "Se borrarán todas tus cercas y ajustes.") {
                    return json!({ "ok": false, "canceled": true });
                }
                replace_everything(&app, store::normalize(&Value::Null));
                json!({ "ok": true })
            }
            _ => json!({ "ok": false }),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fence_menu(app: AppHandle, id: String) {
    let Some(f) = fence_of(&app, &id) else { return };
    let snap = app.state::<AppState>().data.lock().unwrap().settings.snap;
    popup(&app, &id, move |a| build_fence_menu(a, &f, snap));
}

#[tauri::command]
async fn item_menu(app: AppHandle, id: String, args: Option<Value>) -> Option<String> {
    let args = args?;
    let path = args.get("path")?.as_str()?.to_string();
    let index = args.get("index").and_then(|v| v.as_i64()).unwrap_or(-1);
    let f = fence_of(&app, &id)?;
    let others: Vec<(String, String)> = {
        let d = app.state::<AppState>();
        let d = d.data.lock().unwrap();
        d.fences.iter().filter(|o| o.id != id && o.portal.is_none()).map(|o| (o.id.clone(), o.title.clone())).collect()
    };
    let renamed = index >= 0 && f.items.get(index as usize).map(|i| i.n.is_some()).unwrap_or(false);
    let back = {
        let st = app.state::<AppState>();
        let hide = st.data.lock().unwrap().settings.hide_desktop;
        hide && desk::in_desktop(&path, &desk::desktop_dirs(st.desktop.clone()))
    };
    let id2 = id.clone();
    popup(&app, &id2, move |a| {
        let mut t: Vec<MI> = vec![
            item(a, mid(&id, "i-open", &path), "Abrir", true),
            item(a, mid(&id, "show", &path), "Mostrar en carpeta", true),
            item(a, mid(&id, "i-copy", &path), "Copiar ruta", true),
        ];
        if f.portal.is_none() {
            t.push(sep(a));
            t.push(item(a, mid(&id, "i-rename", &path), "Cambiar nombre mostrado…", true));
            if renamed {
                t.push(item(a, mid(&id, "i-restore", &path), "Restaurar nombre original", true));
            }
            if !others.is_empty() {
                let subs: Vec<MI> = others.iter().map(|(oid, title)| item(a, mid(&id, "moveto", &format!("{oid}|{path}")), title, true)).collect();
                t.push(sub(a, "Mover a", subs));
            }
            t.push(item(a, mid(&id, "i-remove", &path), if back { "Sacar de la cerca (vuelve al Escritorio)" } else { "Quitar de la cerca" }, true));
        }
        menu_of(a, t)
    });
    None
}

#[tauri::command]
fn item_transfer() -> bool {
    false
}

/// Se soltó un elemento fuera de su cerca: pasa a otra cerca si el cursor está sobre una, o sale de la cerca.
#[tauri::command]
fn item_release(app: AppHandle, id: String, args: Option<Value>) -> Option<String> {
    let path = args.as_ref()?.get("path")?.as_str()?.to_string();
    let cur = app.cursor_position().ok()?;
    let mut target: Option<String> = None;
    for w in fence_windows(&app) {
        if !w.is_visible().unwrap_or(false) {
            continue;
        }
        let (Ok(p), Ok(s)) = (w.outer_position(), w.outer_size()) else { continue };
        if cur.x >= p.x as f64 && cur.x < (p.x + s.width as i32) as f64 && cur.y >= p.y as f64 && cur.y < (p.y + s.height as i32) as f64 {
            let wid = id_of(w.label());
            if wid == id {
                return None;
            }
            target = Some(wid);
            break;
        }
    }
    move_item(&app, &id, target.as_deref(), &path)
}

/* ---------- arranque ---------- */
fn data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("MC_USER_DATA") {
        return PathBuf::from(p);
    }
    app.path().config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("mis-cercas")
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let new_item = MenuItem::with_id(app, "new", "Nueva cerca", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Mostrar u ocultar cercas", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Configuración…", true, None::<&str>)?;
    let folder = MenuItem::with_id(app, "folder", "Abrir carpeta de datos", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&new_item, &toggle, &sep, &settings, &folder, &sep2, &quit])?;
    let mut b = TrayIconBuilder::new().tooltip("Mis Cercas").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.on_menu_event(|app, ev| {
        let app = app.clone();
        let id = ev.id().as_ref().to_string();
        // crear ventanas desde el hilo principal bloquea Windows: se hace en otro hilo
        bg(move || match id.as_str() {
            "new" => add_fence(&app, None, "", None),
            "toggle" => toggle_all(&app),
            "settings" => open_settings(&app),
            "folder" => {
                let st = app.state::<AppState>();
                icons::open(&st.dir.to_string_lossy());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    })
    .on_tray_icon_event(|tray, ev| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
            toggle_all(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_all(app);
                    }
                })
                .build(),
        )
        .on_menu_event(|app, ev| {
            let id = ev.id().as_ref().to_string();
            if id.starts_with("cm|") {
                handle_menu(app, &id);
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = data_dir(&handle);
            let mut data = store::load(&dir);
            if data.fences.is_empty() {
                data.fences.push(store::sanitize_fence(&json!({ "title": "Mi primera cerca" })));
            }
            let keep = data.settings.keep_on_top;
            let hotkey = data.settings.hotkey.clone();
            let fences = data.fences.clone();
            let desktop = handle.path().desktop_dir().ok();
            app.manage(AppState {
                dir,
                desktop,
                data: Mutex::new(data),
                dirty: AtomicBool::new(true),
                icons: Mutex::new(HashMap::new()),
                all_hidden: AtomicBool::new(false),
                fs: Mutex::new(HashMap::new()),
            });
            for f in &fences {
                create_fence_window(&handle, f, keep);
            }
            build_tray(&handle)?;
            desk::guard::start(handle.clone());
            if let Err(e) = handle.global_shortcut().register(hotkey.as_str()) {
                eprintln!("No se pudo registrar el atajo {hotkey}: {e}");
            }
            // guarda los cambios poco después de hacerlos y vigila el ratón (enrollar, imán)
            let h2 = handle.clone();
            std::thread::spawn(move || {
                let mut n = 0u32;
                loop {
                    std::thread::sleep(Duration::from_millis(90));
                    tick(&h2);
                    n += 1;
                    if n % 4 == 0 {
                        h2.state::<AppState>().flush();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            state_get, settings_get, settings_set, fence_patch, items_info, icon_get, item_open, item_add, portal_list,
            app_action, data_action, fence_menu, item_menu, item_transfer, item_release
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Mis Cercas")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code, .. } => {
                // aplicación de bandeja: cerrar la última ventana no la cierra; solo «Salir»
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => app.state::<AppState>().flush(),
            _ => {}
        });
}
