use axum::{Json, Router, extract::State, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;

pub(crate) fn repo_routes() -> Router<AppState> {
    Router::new().route("/api/repos", get(list_repos).post(create_repo))
}

#[derive(Debug, Deserialize)]
struct CreateRepoPayload {
    path: String,
    name: Option<String>,
}

async fn create_repo(
    State(state): State<AppState>,
    Json(payload): Json<CreateRepoPayload>,
) -> Result<Json<Value>, ApiError> {
    let repo_path = std::path::PathBuf::from(payload.path.trim())
        .canonicalize()
        .map_err(|_| ApiError::bad_request("Repository path does not exist."))?;
    if !repo_path.is_dir() {
        return Err(ApiError::bad_request(
            "Repository path does not point to a directory.",
        ));
    }

    let repo = state
        .db
        .create_or_update_repo(
            repo_path.to_string_lossy().as_ref(),
            payload.name.as_deref().map(str::trim),
        )
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "repo": repo })))
}

async fn list_repos(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let repos = state.db.list_repos().map_err(ApiError::internal)?;
    Ok(Json(json!({ "repos": repos })))
}
