mod icons;
mod store;

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct AppState {
    dir: PathBuf,
    data: Mutex<store::Data>,
    dirty: AtomicBool,
    icons: Mutex<HashMap<String, Option<String>>>,
    all_hidden: AtomicBool,
}

impl AppState {
    fn touch(&self) {
        self.dirty.store(true, Ordering::SeqCst);
    }
    fn flush(&self) {
        if self.dirty.swap(false, Ordering::SeqCst) {
            let copy = self.data.lock().unwrap().clone();
            if let Err(e) = store::save(&self.dir, &copy) {
                eprintln!("No se pudo guardar la configuración: {e}");
            }
        }
    }
}

fn key(p: &str) -> String {
    if cfg!(windows) { p.replace('/', "\\").to_lowercase() } else { p.to_string() }
}

/* ---------- ventanas ---------- */
fn label(id: &str) -> String {
    format!("fence-{id}")
}

fn geom_changed(app: &AppHandle, id: &str) {
    let Some(win) = app.get_webview_window(&label(id)) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else { return };
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let state = app.state::<AppState>();
    {
        let mut d = state.data.lock().unwrap();
        if let Some(f) = d.fences.iter_mut().find(|f| f.id == id) {
            f.x = pos.x.round() as i32;
            f.y = pos.y.round() as i32;
            f.w = (size.width.round() as i32).max(store::MIN_W);
            if !f.rolled {
                f.h = (size.height.round() as i32).max(store::MIN_H);
            }
        }
    }
    state.touch();
}

fn create_fence_window(app: &AppHandle, f: &store::Fence, keep_on_top: bool) {
    let name = label(&f.id);
    if app.get_webview_window(&name).is_some() {
        return;
    }
    let h = if f.rolled { store::HEADER_H } else { f.h };
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

fn fence_windows(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter(|(k, _)| k.starts_with("fence-")).map(|(_, w)| w).collect()
}

fn toggle_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    let hide = !state.all_hidden.load(Ordering::SeqCst);
    state.all_hidden.store(hide, Ordering::SeqCst);
    for w in fence_windows(app) {
        let _ = if hide { w.hide() } else { w.show() };
    }
}

fn add_fence(app: &AppHandle, near: Option<&str>) {
    let state = app.state::<AppState>();
    let (fence, keep) = {
        let mut d = state.data.lock().unwrap();
        let (mut x, mut y) = (60 + (d.fences.len() as i32 % 8) * 36, 60 + (d.fences.len() as i32 % 8) * 36);
        if let Some(n) = near.and_then(|id| d.fences.iter().find(|f| f.id == id)) {
            x = n.x + 36;
            y = n.y + 36;
        }
        let f = store::sanitize_fence(&json!({ "x": x, "y": y, "title": "Nueva cerca", "autoRoll": d.settings.default_auto_roll }));
        d.fences.push(f.clone());
        (f, d.settings.keep_on_top)
    };
    state.touch();
    create_fence_window(app, &fence, keep);
}

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

/* ---------- comandos (los que usa la interfaz) ---------- */
fn settings_payload(app: &AppHandle, state: &AppState) -> Value {
    let d = state.data.lock().unwrap();
    json!({
        "settings": d.settings,
        "autoStart": false,
        "version": app.package_info().version.to_string(),
        "dataDir": state.dir.to_string_lossy(),
        "hotkey": d.settings.hotkey,
    })
}

#[tauri::command]
fn state_get(state: State<AppState>, id: String) -> Option<Value> {
    let d = state.data.lock().unwrap();
    let f = d.fences.iter().find(|f| f.id == id)?;
    Some(json!({ "fence": f, "settings": d.settings, "collapsed": f.rolled }))
}

#[tauri::command]
fn settings_get(app: AppHandle, state: State<AppState>) -> Value {
    settings_payload(&app, &state)
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
    let _ = app.emit("settings", json!({ "settings": settings }));
    let mut out = settings_payload(&app, &state);
    out["error"] = error;
    out
}

#[tauri::command]
fn fence_patch(state: State<AppState>, id: String, patch: Value) -> bool {
    {
        let mut d = state.data.lock().unwrap();
        let Some(f) = d.fences.iter_mut().find(|f| f.id == id) else { return false };
        if let Some(t) = patch.get("title").and_then(|v| v.as_str()) {
            let t: String = t.chars().take(80).collect();
            if !t.trim().is_empty() {
                f.title = t.trim().to_string();
            }
        }
        if let Some(a) = patch.get("items").and_then(|v| v.as_array()) {
            f.items = a.iter().filter_map(store::sanitize_item).take(500).collect();
        }
        if let Some(s) = patch.get("sort").and_then(|v| v.as_str()) {
            if ["manual", "name", "type"].contains(&s) {
                f.sort = s.into();
            }
        }
        if let Some(v) = patch.get("view").and_then(|v| v.as_str()) {
            if ["grid", "list"].contains(&v) {
                f.view = v.into();
            }
        }
    }
    state.touch();
    true
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
async fn app_action(app: AppHandle, state: State<'_, AppState>, id: String, name: String) -> Result<(), ()> {
    match name.as_str() {
        "settings" => open_settings(&app),
        "newFence" => add_fence(&app, Some(&id)),
        "toggleAll" => toggle_all(&app),
        "toggleRoll" => {
            let (collapsed, w, h) = {
                let mut d = state.data.lock().unwrap();
                let Some(f) = d.fences.iter_mut().find(|f| f.id == id) else { return Ok(()) };
                if f.auto_roll {
                    return Ok(());
                }
                f.rolled = !f.rolled;
                (f.rolled, f.w, f.h)
            };
            state.touch();
            if let Some(win) = app.get_webview_window(&label(&id)) {
                let height = if collapsed { store::HEADER_H } else { h };
                let _ = win.set_size(LogicalSize::new(w as f64, height as f64));
            }
            let _ = app.emit("layout", json!({ "id": id, "collapsed": collapsed }));
            let _ = app.emit("reload", json!({ "id": id }));
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
fn data_action(state: State<AppState>, name: String) -> Value {
    match name.as_str() {
        "openFolder" => {
            icons::open(&state.dir.to_string_lossy());
            json!({ "ok": true })
        }
        _ => json!({ "ok": false, "error": "Esta acción todavía no está disponible en esta versión de prueba." }),
    }
}

// Pendientes de portar (menús contextuales, mover entre cercas, sacar al Escritorio)
#[tauri::command]
async fn fence_menu(app: AppHandle, id: String) {
    let _ = id;
    open_settings(&app);
}
#[tauri::command]
fn item_menu() -> Option<String> {
    None
}
#[tauri::command]
fn item_transfer() -> bool {
    false
}
#[tauri::command]
fn item_release() -> Option<String> {
    None
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
    b.on_menu_event(|app, ev| match ev.id().as_ref() {
        "new" => add_fence(app, None),
        "toggle" => toggle_all(app),
        "settings" => open_settings(app),
        "folder" => {
            let st = app.state::<AppState>();
            icons::open(&st.dir.to_string_lossy());
        }
        "quit" => app.exit(0),
        _ => {}
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
            app.manage(AppState {
                dir,
                data: Mutex::new(data),
                dirty: AtomicBool::new(true),
                icons: Mutex::new(HashMap::new()),
                all_hidden: AtomicBool::new(false),
            });
            for f in &fences {
                create_fence_window(&handle, f, keep);
            }
            build_tray(&handle)?;
            if let Err(e) = handle.global_shortcut().register(hotkey.as_str()) {
                eprintln!("No se pudo registrar el atajo {hotkey}: {e}");
            }
            // guarda los cambios poco después de hacerlos (mover o redimensionar avisa muchas veces)
            let h2 = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(300));
                h2.state::<AppState>().flush();
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
