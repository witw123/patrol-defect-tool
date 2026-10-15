// 巡检缺陷命名分类工具 —— Tauri 后端
// 设计：原 HTML 通过浏览器 File System Access API 操作目录；
// Tauri 版以自定义协议 + 命令提供等价能力，前端 shim 将其包装成
// FileSystemDirectoryHandle / FileSystemFileHandle，HTML 逻辑零改动。
//
// pdefile  协议：GET  http://pdefile.localhost/<base64url(路径)>  → 文件字节
// pdefilew 协议：POST http://pdefilew.localhost/<base64url(路径)> 请求体为文件字节 → 写文件
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(serde::Serialize)]
struct Entry {
    name: String,
    is_dir: bool,
}

fn decode_path(encoded: &str) -> Option<PathBuf> {
    let raw = encoded.trim();
    let unescaped = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()?;
    let clean = unescaped.trim();
    let clean_no_pad = clean.trim_end_matches('=');

    let decoded_bytes = B64.decode(clean_no_pad)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(clean))
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(clean_no_pad))
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(clean))
        .ok()?;
    let text = String::from_utf8(decoded_bytes).ok()?;
    Some(PathBuf::from(text))
}

fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("tif" | "tiff") => "image/tiff",
        Some("json") => "application/json",
        Some("html") => "text/html",
        Some("js") => "text/javascript",
        _ => "application/octet-stream",
    }
}

// 高速写入：JS 以原始字节为请求体（免 JSON/base64 序列化），路径放在头里。
#[tauri::command]
fn write_file_raw(request: tauri::ipc::Request) -> Result<(), String> {
    use tauri::ipc::InvokeBody;
    let encoded = request
        .headers()
        .get("x-file-path-b64")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "缺少 x-file-path-b64 头".to_string())?;
    let path = decode_path(encoded).ok_or_else(|| "路径解码失败".to_string())?;
    match request.body() {
        InvokeBody::Raw(bytes) => write_atomic(&path, bytes),
        InvokeBody::Json(_) => Err("请求体应为原始字节".to_string()),
    }
}

#[tauri::command]
fn copy_file(from: String, to: String) -> Result<(), String> {
    let to_path = Path::new(&to);
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, to_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_zoom(app: tauri::AppHandle, scale: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    window.set_zoom(scale).map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
fn list_entries(path: String) -> Result<Vec<Entry>, String> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for item in read_dir.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(Entry { name, is_dir });
    }
    Ok(entries)
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    write_atomic(Path::new(&path), &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_file_name(format!(
        ".{}.tmp",
        std::process::id() as u128 + rand_suffix()
    ));
    {
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
    if let Err(e) = std::fs::rename(&temp, path) {
        std::fs::write(path, bytes).map_err(|e2| format!("保存文件失败(重命名: {}, 直接写: {})", e, e2))?;
        let _ = std::fs::remove_file(&temp);
    }
    Ok(())
}

fn rand_suffix() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u128)
        .unwrap_or(0)
}

#[tauri::command]
fn mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let from = Path::new(&path);
    let parent = from
        .parent()
        .ok_or_else(|| "无法确定父目录".to_string())?;
    let to = parent.join(&new_name);
    std::fs::rename(from, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

#[tauri::command]
fn remove_entry(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        if recursive {
            std::fs::remove_dir_all(p).map_err(|e| e.to_string())
        } else {
            std::fs::remove_dir(p).map_err(|e| e.to_string())
        }
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}


// ---------- 安装目录数据持久化 ----------
// 数据文件统一放在 <exe 目录>/data；目录不可写时回退到 %LOCALAPPDATA%\PatrolDefect\data。
fn data_dir() -> Result<PathBuf, String> {
    static DIR: std::sync::OnceLock<Result<PathBuf, String>> = std::sync::OnceLock::new();
    if let Some(dir) = DIR.get() {
        return dir.clone();
    }
    let resolved: Result<PathBuf, String> = (|| {
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or_else(|| "无法确定程序目录".to_string())?
            .to_path_buf();
        let candidate = exe_dir.join("data");
        std::fs::create_dir_all(&candidate).map_err(|e| e.to_string())?;
        let probe = candidate.join(".writable");
        std::fs::write(&probe, b"1").map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&probe);
        Ok(candidate)
    })();
    let fallback = || -> Result<PathBuf, String> {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let candidate = PathBuf::from(base).join("PatrolDefect").join("data");
        std::fs::create_dir_all(&candidate).map_err(|e| e.to_string())?;
        Ok(candidate)
    };
    let dir = resolved.or_else(|_| fallback());
    let _ = DIR.set(dir.clone());
    dir
}

fn safe_name(name: &str) -> Result<String, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err("非法的数据文件名".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
fn app_data_dir() -> Result<String, String> {
    data_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn read_app_file(name: String) -> Option<String> {
    let name = safe_name(&name).ok()?;
    let dir = data_dir().ok()?;
    std::fs::read_to_string(dir.join(name)).ok()
}

#[tauri::command]
fn write_app_file(name: String, content: String) -> Result<String, String> {
    let name = safe_name(&name)?;
    let dir = data_dir()?;
    let target = dir.join(&name);
    write_atomic(&target, content.as_bytes())?;
    Ok(target.to_string_lossy().to_string())
}

fn main() {
    let stored_state = data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("localStorage.json")).ok())
        .unwrap_or_default();
    let init_state = if stored_state.trim().is_empty() {
        "window.__PATROL_DATA__ = {};".to_string()
    } else {
        format!("window.__PATROL_DATA__ = {};", stored_state)
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let win = tauri::webview::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("巡检缺陷命名分类工具")
            .inner_size(1600.0, 950.0)
            .min_inner_size(1100.0, 680.0)
            .drag_and_drop(false)
            .initialization_script(&init_state)
            .build()?;
            let _ = win.set_focus();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_zoom,
            copy_file,
            write_file_raw,
            app_data_dir,
            read_app_file,
            write_app_file,
            pick_folder,
            list_entries,
            read_file_base64,
            write_file_base64,
            mkdir,
            rename_entry,
            remove_entry,
            exists,
            is_dir
        ])
        .register_uri_scheme_protocol("pdefile", |_ctx, request| {
            let uri = request.uri().to_string();
            let encoded = uri
                .split_once("localhost/")
                .map(|(_, rest)| rest.split(['?', '#']).next().unwrap_or(rest))
                .unwrap_or("");
            match decode_path(encoded) {
                Some(path) if path.is_file() => match std::fs::read(&path) {
                    Ok(bytes) => tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime_of(&path))
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap(),
                    Err(e) => tauri::http::Response::builder()
                        .status(404)
                        .body(e.to_string().into_bytes())
                        .unwrap(),
                },
                _ => tauri::http::Response::builder()
                    .status(404)
                    .body(b"not found".to_vec())
                    .unwrap(),
            }
        })
        .register_uri_scheme_protocol("pdefilew", |_ctx, request| {
            let uri = request.uri().to_string();
            let encoded = uri
                .split_once("localhost/")
                .map(|(_, rest)| rest.split(['?', '#']).next().unwrap_or(rest))
                .unwrap_or("");
            if request.method() == "OPTIONS" {
                return tauri::http::Response::builder()
                    .status(200)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "POST, OPTIONS")
                    .header("Access-Control-Allow-Headers", "*")
                    .body(b"".to_vec())
                    .unwrap();
            }
            let body = request.body().clone();
            match decode_path(encoded) {
                Some(path) => match write_atomic(&path, &body) {
                    Ok(()) => tauri::http::Response::builder()
                        .status(200)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(b"ok".to_vec())
                        .unwrap(),
                    Err(e) => tauri::http::Response::builder()
                        .status(500)
                        .body(e.into_bytes())
                        .unwrap(),
                },
                None => tauri::http::Response::builder()
                    .status(400)
                    .body(b"bad path".to_vec())
                    .unwrap(),
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
