use axum::{Json, Router, extract::{Path, State}, routing::{get, patch}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::executor::list_branches;

pub(crate) fn repo_routes() -> Router<AppState> {
    Router::new()
        .route("/api/repos", get(list_repos).post(create_repo))
        .route("/api/repos/{repo_id}", patch(update_repo))
        .route("/api/repos/{repo_id}/branches", get(get_branches))
}

#[derive(Debug, Deserialize)]
struct RepoPath {
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct CreateRepoPayload {
    path: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateRepoPayload {
    #[serde(rename = "defaultBranch")]
    default_branch: Option<String>,
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

async fn update_repo(
    State(state): State<AppState>,
    Path(path): Path<RepoPath>,
    Json(payload): Json<UpdateRepoPayload>,
) -> Result<Json<Value>, ApiError> {
    let repo = state
        .db
        .get_repo_by_id(&path.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    if let Some(ref branch) = payload.default_branch {
        let branch = branch.trim();
        if !branch.is_empty() {
            state
                .db
                .update_repo_default_branch(&repo.id, branch)
                .map_err(ApiError::internal)?;
        }
    }

    if let Some(ref name) = payload.name {
        let name = name.trim();
        if !name.is_empty() {
            state
                .db
                .create_or_update_repo(&repo.path, Some(name))
                .map_err(ApiError::internal)?;
        }
    }

    let updated = state
        .db
        .get_repo_by_id(&path.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;
    Ok(Json(json!({ "repo": updated })))
}

async fn get_branches(
    State(state): State<AppState>,
    Path(path): Path<RepoPath>,
) -> Result<Json<Value>, ApiError> {
    let repo = state
        .db
        .get_repo_by_id(&path.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    let branches = list_branches(&repo.path).map_err(ApiError::internal)?;
    Ok(Json(json!({ "branches": branches, "default": repo.default_branch })))
}
