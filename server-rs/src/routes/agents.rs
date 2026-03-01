use axum::{Json, Router, extract::{Query, State}, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::discovery::discover_agent_profiles;
use crate::errors::ApiError;
use super::shared::RepoQuery;

pub(crate) fn agent_routes() -> Router<AppState> {
    Router::new()
        .route("/api/agents/discover", get(discover_agents))
        .route("/api/agents", get(list_agents))
        .route("/api/agents/select", axum::routing::post(select_repo_agent))
        .route("/api/agents/selection", get(get_repo_agent_selection))
}

#[derive(Debug, Deserialize)]
struct SelectAgentPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "profileId")]
    profile_id: String,
}

async fn discover_agents(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let discovered = discover_agent_profiles();
    let synced = state
        .db
        .upsert_agent_profiles(&discovered)
        .map_err(ApiError::internal)?;
    let profiles = state.db.list_agent_profiles().map_err(ApiError::internal)?;
    Ok(Json(json!({
      "synced": synced,
      "profiles": profiles
    })))
}

async fn list_agents(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let profiles = state.db.list_agent_profiles().map_err(ApiError::internal)?;
    Ok(Json(json!({ "profiles": profiles })))
}

async fn select_repo_agent(
    State(state): State<AppState>,
    Json(payload): Json<SelectAgentPayload>,
) -> Result<Json<Value>, ApiError> {
    if state
        .db
        .get_repo_by_id(&payload.repo_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Repo not found."));
    }
    if state
        .db
        .get_agent_profile_by_id(&payload.profile_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Agent profile not found."));
    }
    let selection = state
        .db
        .set_repo_agent_preference(&payload.repo_id, &payload.profile_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "selection": selection })))
}

async fn get_repo_agent_selection(
    State(state): State<AppState>,
    Query(query): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let selection = state
        .db
        .get_repo_agent_preference(&query.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "selection": selection })))
}
