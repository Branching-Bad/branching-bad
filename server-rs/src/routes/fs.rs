use axum::{Json, Router, extract::Query, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use super::shared::home_dir;

pub(crate) fn fs_routes() -> Router<AppState> {
    Router::new().route("/api/fs/list", get(fs_list))
}

#[derive(Debug, Deserialize)]
struct FsListQuery {
    path: Option<String>,
}

async fn fs_list(Query(query): Query<FsListQuery>) -> Result<Json<Value>, ApiError> {
    let base = if let Some(ref p) = query.path {
        let p = p.trim();
        if p.is_empty() {
            home_dir()
        } else {
            std::path::PathBuf::from(p)
        }
    } else {
        home_dir()
    };

    let canonical = base
        .canonicalize()
        .map_err(|_| ApiError::bad_request("Cannot resolve path."))?;

    if !canonical.is_dir() {
        return Err(ApiError::bad_request("Path is not a directory."));
    }

    let mut dirs: Vec<Value> = Vec::new();
    let mut read_dir = std::fs::read_dir(&canonical)
        .map_err(|e| ApiError::bad_request(format!("Cannot read directory: {}", e)))?;

    while let Some(Ok(entry)) = read_dir.next() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let full_path = entry.path().to_string_lossy().to_string();
        let is_git = entry.path().join(".git").exists();
        dirs.push(json!({ "name": name, "path": full_path, "isGit": is_git }));
    }

    dirs.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        an.to_lowercase().cmp(&bn.to_lowercase())
    });

    Ok(Json(json!({
        "path": canonical.to_string_lossy(),
        "parent": canonical.parent().map(|p| p.to_string_lossy().to_string()),
        "dirs": dirs
    })))
}
