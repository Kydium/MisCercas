//! Datos de Mis Cercas: mismo archivo y formato (`fences.json`, versión 2) que la versión de Electron,
//! para que las cercas y ajustes existentes sigan funcionando sin cambios.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const MIN_W: i32 = 170;
pub const MIN_H: i32 = 110;
pub const HEADER_H: i32 = 36;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub accent_follows_theme: bool,
    pub titlebar: String,
    pub finish: String,
    pub hide_desktop: bool,
    pub snap: bool,
    pub keep_on_top: bool,
    pub opacity: f64,
    pub radius: i64,
    pub icon_size: i64,
    pub show_labels: bool,
    pub open_with: String,
    pub hotkey: String,
    pub animations: bool,
    pub default_auto_roll: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "auto".into(),
            accent: "#4d8dff".into(),
            accent_follows_theme: true,
            titlebar: "theme".into(),
            finish: "flat".into(),
            hide_desktop: true,
            snap: true,
            keep_on_top: false,
            opacity: 0.62,
            radius: 10,
            icon_size: 40,
            show_labels: true,
            open_with: "double".into(),
            hotkey: "Control+Alt+F".into(),
            animations: true,
            default_auto_roll: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Item {
    pub p: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Portal {
    pub dirs: Vec<String>,
    pub filter: String,
    pub sort: String,
    pub show_hidden: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fence {
    pub id: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub rolled: bool,
    pub locked: bool,
    pub pinned: bool,
    pub auto_roll: bool,
    pub view: String,
    pub sort: String,
    pub color: Option<String>,
    pub portal: Option<Portal>,
    pub items: Vec<Item>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Data {
    pub version: u32,
    pub settings: Settings,
    pub fences: Vec<Fence>,
    pub snapshots: Vec<Value>,
    pub hidden: Vec<String>,
}

/* ---------- utilidades de saneado ---------- */
fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|x| x.to_string())
}
fn b(v: &Value, k: &str, d: bool) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(d)
}
fn n(v: &Value, k: &str, d: f64, lo: f64, hi: f64) -> f64 {
    match v.get(k).and_then(|x| x.as_f64()) {
        Some(x) if x.is_finite() => x.clamp(lo, hi),
        _ => d,
    }
}
fn one_of(v: &Value, k: &str, allowed: &[&str], d: &str) -> String {
    match v.get(k).and_then(|x| x.as_str()) {
        Some(x) if allowed.contains(&x) => x.to_string(),
        _ => d.to_string(),
    }
}
pub fn is_hex(x: &str) -> bool {
    x.len() == 7 && x.starts_with('#') && x[1..].chars().all(|c| c.is_ascii_hexdigit())
}
fn hex(v: &Value, k: &str) -> Option<String> {
    s(v, k).filter(|x| is_hex(x))
}

pub fn sanitize_settings(r: &Value) -> Settings {
    let d = Settings::default();
    let custom_accent = hex(r, "accent").map(|a| a.to_lowercase() != d.accent).unwrap_or(false);
    let icon = n(r, "iconSize", d.icon_size as f64, 0.0, 1000.0) as i64;
    Settings {
        theme: s(r, "theme").filter(|t| !t.is_empty() && t.len() < 40).unwrap_or(d.theme.clone()),
        accent: hex(r, "accent").unwrap_or(d.accent.clone()),
        accent_follows_theme: b(r, "accentFollowsTheme", !custom_accent),
        titlebar: one_of(r, "titlebar", &["theme", "solid", "glass", "clear"], &d.titlebar),
        finish: one_of(r, "finish", &["flat", "raised"], &d.finish),
        hide_desktop: b(r, "hideDesktop", d.hide_desktop),
        snap: b(r, "snap", d.snap),
        keep_on_top: b(r, "keepOnTop", d.keep_on_top),
        opacity: n(r, "opacity", d.opacity, 0.2, 0.95),
        radius: n(r, "radius", d.radius as f64, 0.0, 22.0).round() as i64,
        icon_size: if [28, 40, 52, 64].contains(&icon) { icon } else { d.icon_size },
        show_labels: b(r, "showLabels", d.show_labels),
        open_with: one_of(r, "openWith", &["double", "single"], &d.open_with),
        hotkey: s(r, "hotkey").filter(|h| !h.is_empty() && h.len() <= 60).unwrap_or(d.hotkey.clone()),
        animations: b(r, "animations", d.animations),
        default_auto_roll: b(r, "defaultAutoRoll", d.default_auto_roll),
    }
}

pub fn sanitize_item(i: &Value) -> Option<Item> {
    if let Some(p) = i.as_str() {
        return if p.is_empty() { None } else { Some(Item { p: p.into(), n: None }) };
    }
    let p = s(i, "p").filter(|p| !p.is_empty())?;
    let name = s(i, "n").map(|x| x.trim().chars().take(120).collect::<String>()).filter(|x| !x.is_empty());
    Some(Item { p, n: name })
}

fn sanitize_portal(p: &Value) -> Option<Portal> {
    let p = if let Some(d) = p.as_str() { json!({ "dirs": [d] }) } else { p.clone() };
    if !p.is_object() {
        return None;
    }
    let mut dirs: Vec<String> = match p.get("dirs").and_then(|d| d.as_array()) {
        Some(a) => a.iter().filter_map(|x| x.as_str()).filter(|x| !x.is_empty()).map(String::from).collect(),
        None => s(&p, "dir").filter(|x| !x.is_empty()).into_iter().collect(),
    };
    if dirs.is_empty() {
        return None;
    }
    dirs.truncate(4);
    Some(Portal {
        dirs,
        filter: s(&p, "filter").unwrap_or_else(|| "all".into()),
        sort: one_of(&p, "sort", &["name", "date", "size", "type"], "name"),
        show_hidden: b(&p, "showHidden", false),
    })
}

pub fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(1);
    format!("{:x}{:04x}", (t / 1_000_000) as u64, (t % 65_521) as u32)
}

pub fn sanitize_fence(r: &Value) -> Fence {
    let title: String = s(r, "title").unwrap_or_default().chars().take(80).collect();
    let title = title.trim().to_string();
    Fence {
        id: s(r, "id").filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(new_id),
        title: if title.is_empty() { "Nueva cerca".into() } else { title },
        x: n(r, "x", 80.0, -30000.0, 30000.0).round() as i32,
        y: n(r, "y", 80.0, -30000.0, 30000.0).round() as i32,
        w: n(r, "w", 320.0, MIN_W as f64, 4000.0).round() as i32,
        h: n(r, "h", 240.0, MIN_H as f64, 4000.0).round() as i32,
        rolled: b(r, "rolled", false),
        locked: b(r, "locked", false),
        pinned: b(r, "pinned", false),
        auto_roll: b(r, "autoRoll", false),
        view: one_of(r, "view", &["grid", "list"], "grid"),
        sort: one_of(r, "sort", &["manual", "name", "type"], "manual"),
        color: hex(r, "color"),
        portal: r.get("portal").and_then(sanitize_portal),
        items: r
            .get("items")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(sanitize_item).take(500).collect())
            .unwrap_or_default(),
    }
}

pub fn normalize(raw: &Value) -> Data {
    let src = if raw.is_array() { json!({ "fences": raw }) } else if raw.is_object() { raw.clone() } else { json!({}) };
    let mut seen = std::collections::HashSet::new();
    let fences = src
        .get("fences")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().map(sanitize_fence).filter(|f| seen.insert(f.id.clone())).collect())
        .unwrap_or_default();
    Data {
        version: 2,
        settings: sanitize_settings(src.get("settings").unwrap_or(&Value::Null)),
        fences,
        snapshots: src.get("snapshots").and_then(|a| a.as_array()).cloned().unwrap_or_default().into_iter().take(12).collect(),
        hidden: src
            .get("hidden")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| !x.is_empty()).map(String::from).take(3000).collect())
            .unwrap_or_default(),
    }
}

/* ---------- disco ---------- */
pub fn load(dir: &Path) -> Data {
    let file = dir.join("fences.json");
    let bak = dir.join("fences.json.bak");
    for f in [file, bak] {
        if let Ok(txt) = std::fs::read_to_string(&f) {
            if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                return normalize(&v);
            }
        }
    }
    normalize(&Value::Null)
}

pub fn save(dir: &Path, data: &Data) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let file: PathBuf = dir.join("fences.json");
    let tmp = dir.join("fences.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(data).unwrap_or_default())?;
    if file.exists() {
        let _ = std::fs::copy(&file, dir.join("fences.json.bak"));
    }
    std::fs::rename(&tmp, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_el_formato_de_electron() {
        let raw = json!({
            "version": 2,
            "settings": { "theme": "nord", "accent": "#112233", "iconSize": 52, "opacity": 5, "hotkey": "Control+Alt+G", "snap": false },
            "fences": [
                { "id": "abc1", "title": "  Juegos ", "x": 10, "y": 20, "w": 50, "h": 9000,
                  "items": ["C:\\a.lnk", { "p": "C:\\b.lnk", "n": " Mi B " }, { "p": "" }, 5], "portal": null, "color": "#ff0000" },
                { "id": "abc1", "title": "duplicada" }
            ],
            "hidden": ["C:\\a.lnk"]
        });
        let d = normalize(&raw);
        assert_eq!(d.fences.len(), 1);
        let f = &d.fences[0];
        assert_eq!(f.title, "Juegos");
        assert_eq!((f.w, f.h), (MIN_W, 4000));
        assert_eq!(f.items.len(), 2);
        assert_eq!(f.items[1].n.as_deref(), Some("Mi B"));
        assert_eq!(f.color.as_deref(), Some("#ff0000"));
        assert_eq!(d.settings.theme, "nord");
        assert_eq!(d.settings.icon_size, 52);
        assert_eq!(d.settings.opacity, 0.95);
        assert!(!d.settings.snap);
        assert!(!d.settings.accent_follows_theme); // eligió un acento propio
        assert_eq!(d.hidden, vec!["C:\\a.lnk".to_string()]);
    }

    #[test]
    fn vacio_da_valores_por_defecto() {
        let d = normalize(&Value::Null);
        assert!(d.fences.is_empty());
        assert_eq!(d.settings.hotkey, "Control+Alt+F");
        assert!(d.settings.hide_desktop);
    }

    #[test]
    fn ida_y_vuelta_conserva_nombres_camel_case() {
        let d = normalize(&json!({ "fences": [{ "id": "z9", "autoRoll": true, "items": [{ "p": "x" }] }] }));
        let txt = serde_json::to_string(&d).unwrap();
        assert!(txt.contains("\"autoRoll\":true"));
        assert!(txt.contains("\"hideDesktop\":true"));
        let d2 = normalize(&serde_json::from_str::<Value>(&txt).unwrap());
        assert!(d2.fences[0].auto_roll);
    }
}
