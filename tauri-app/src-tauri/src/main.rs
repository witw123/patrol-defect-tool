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

#[derive(serde::Serialize)]
struct Entry {
    name: String,
    is_dir: bool,
}

fn decode_path(encoded: &str) -> Option<PathBuf> {
    let bytes = B64.decode(encoded.trim()).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    Some(PathBuf::from(text))
}

fn encode_path(path: &Path) -> String {
    B64.encode(path.to_string_lossy().as_bytes())
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
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
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
