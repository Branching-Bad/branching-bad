use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::models::CreateTaskPayload;
use crate::provider::elasticsearch::{es_client::EsClient, investigator};

pub fn elasticsearch_routes() -> Router<AppState> {
    Router::new()
        .route("/api/elasticsearch/investigate", post(es_investigate))
        .route("/api/elasticsearch/investigations/{id}", get(es_get_investigation))
        .route("/api/elasticsearch/investigations/{id}/analyze", post(es_analyze))
        .route("/api/elasticsearch/investigations/{id}/regenerate", post(es_regenerate))
        .route("/api/elasticsearch/investigations/{id}/create-task", post(es_create_task))
        .route("/api/elasticsearch/investigations", get(es_list_investigations))
        .route("/api/elasticsearch/saved-queries", get(es_list_saved_queries).post(es_create_saved_query))
        .route("/api/elasticsearch/saved-queries/{id}", axum::routing::delete(es_delete_saved_query))
        .route("/api/elasticsearch/saved-queries/{id}/run", post(es_run_saved_query))
}

#[derive(Debug, Deserialize)]
struct EsInvestigatePayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "indexPattern")]
    index_pattern: String,
    question: String,
    #[serde(rename = "timeRangeMinutes")]
    time_range_minutes: Option<i64>,
}

async fn es_investigate(
    State(state): State<AppState>,
    Json(payload): Json<EsInvestigatePayload>,
) -> Result<Json<Value>, ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let time_range = payload.time_range_minutes.unwrap_or(60);

    let inv = state
        .db
        .create_es_investigation(
            &id,
            &payload.repo_id,
            &payload.account_id,
            &payload.index_pattern,
            &payload.question,
            time_range,
        )
        .map_err(ApiError::internal)?;

    let repo = state
        .db
        .get_repo_by_id(&payload.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found"))?;

    let account = state
        .db
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found"))?;
    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);

    let agent_command = crate::routes::shared::resolve_agent_command(&state, &payload.repo_id)
        .ok_or_else(|| ApiError::bad_request("Select an AI profile for this repo first."))?;

    let db = state.db.clone();
    let inv_id = id.clone();
    let question = payload.question.clone();
    let index_pattern = payload.index_pattern.clone();
    let repo_path = repo.path.clone();

    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        let es = EsClient::from_config(&config);

        let req = investigator::InvestigationRequest {
            question: question.clone(),
            index_pattern: index_pattern.clone(),
            time_range_minutes: time_range,
            repo_path: repo_path.clone(),
            agent_command,
        };

        let result = rt.block_on(investigator::run_phase1(&req, &es));

        match result {
            Ok(inv_result) => {
                let result_json = serde_json::to_value(&inv_result).unwrap_or_default();
                let status = if inv_result.error_logs.is_empty() {
                    "no_results"
                } else {
                    "logs_ready"
                };
                let query_str = serde_json::to_string(&inv_result.phase1_query).unwrap_or_default();
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    status,
                    Some(&result_json),
                    Some(&query_str),
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
            }
        }
    });

    Ok(Json(json!({ "id": inv.id, "status": inv.status })))
}

async fn es_get_investigation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_es_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;
    Ok(Json(json!({ "investigation": inv })))
}

#[derive(Debug, Deserialize)]
struct EsRepoQuery {
    repo_id: String,
}

async fn es_list_investigations(
    State(state): State<AppState>,
    Query(q): Query<EsRepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let list = state
        .db
        .list_es_investigations(&q.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "investigations": list })))
}

async fn es_analyze(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_es_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    if inv.status != "logs_ready" {
        return Err(ApiError::bad_request(format!(
            "Investigation status is '{}', expected 'logs_ready'",
            inv.status
        )));
    }

    state
        .db
        .update_es_investigation_status(&id, "analyzing", None, None, None)
        .map_err(ApiError::internal)?;

    let repo = state
        .db
        .get_repo_by_id(&inv.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found"))?;

    let agent_command = crate::routes::shared::resolve_agent_command(&state, &inv.repo_id)
        .ok_or_else(|| ApiError::bad_request("Select an AI profile for this repo first."))?;

    let db = state.db.clone();
    let inv_id = id.clone();
    let question = inv.question.clone();
    let repo_path = repo.path.clone();
    let result_json = inv.result_json.clone();

    tokio::task::spawn_blocking(move || {
        let inv_result: investigator::InvestigationResult =
            match serde_json::from_value(result_json) {
                Ok(r) => r,
                Err(e) => {
                    let _ = db.update_es_investigation_status(
                        &inv_id,
                        "failed",
                        None,
                        None,
                        Some(&format!("Failed to parse result: {}", e)),
                    );
                    return;
                }
            };

        match investigator::run_analysis(&question, &inv_result, &agent_command, &repo_path) {
            Ok(analysis) => {
                let mut updated = inv_result;
                updated.analysis = Some(analysis);
                let updated_json = serde_json::to_value(&updated).unwrap_or_default();
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "completed",
                    Some(&updated_json),
                    None,
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
            }
        }
    });

    Ok(Json(json!({ "status": "analyzing" })))
}

async fn es_regenerate(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_es_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    state
        .db
        .update_es_investigation_status(&id, "running", Some(&json!({})), None, None)
        .map_err(ApiError::internal)?;

    let repo = state
        .db
        .get_repo_by_id(&inv.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found"))?;

    let account = state
        .db
        .get_provider_account(&inv.provider_account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found"))?;
    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);

    let agent_command = crate::routes::shared::resolve_agent_command(&state, &inv.repo_id)
        .ok_or_else(|| ApiError::bad_request("Select an AI profile for this repo first."))?;

    let db = state.db.clone();
    let inv_id = id.clone();

    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        let es = EsClient::from_config(&config);

        let req = investigator::InvestigationRequest {
            question: inv.question.clone(),
            index_pattern: inv.index_pattern.clone(),
            time_range_minutes: inv.time_range_minutes,
            repo_path: repo.path.clone(),
            agent_command,
        };

        match rt.block_on(investigator::run_phase1(&req, &es)) {
            Ok(inv_result) => {
                let result_json = serde_json::to_value(&inv_result).unwrap_or_default();
                let status = if inv_result.error_logs.is_empty() {
                    "no_results"
                } else {
                    "logs_ready"
                };
                let query_str = serde_json::to_string(&inv_result.phase1_query).unwrap_or_default();
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    status,
                    Some(&result_json),
                    Some(&query_str),
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
            }
        }
    });

    Ok(Json(json!({ "status": "running" })))
}

async fn es_create_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_es_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    let inv_result: investigator::InvestigationResult =
        serde_json::from_value(inv.result_json.clone())
            .map_err(|e| ApiError::bad_request(format!("Failed to parse result: {}", e)))?;

    let description = investigator::build_task_description(&inv.question, &inv_result);
    let title = format!(
        "[ES] {}",
        if inv.question.len() > 60 {
            format!("{}...", &inv.question[..60])
        } else {
            inv.question.clone()
        }
    );

    let task_payload = CreateTaskPayload {
        repo_id: inv.repo_id.clone(),
        title,
        description: Some(description),
        priority: Some("high".to_string()),
        status: None,
        require_plan: Some(true),
        auto_start: Some(false),
        auto_approve_plan: None,
        use_worktree: None,
        agent_profile_id: None,
    };

    let task = state
        .db
        .create_manual_task(&task_payload)
        .map_err(ApiError::internal)?;

    state
        .db
        .set_es_investigation_linked_task(&id, &task.id)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "task": { "id": task.id, "title": task.title } })))
}

// ── Saved Queries ──

#[derive(Debug, Deserialize)]
struct EsSaveQueryPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "indexPattern")]
    index_pattern: String,
    label: String,
    question: String,
    #[serde(rename = "queryTemplate")]
    query_template: String,
    #[serde(default)]
    keywords: String,
}

async fn es_list_saved_queries(
    State(state): State<AppState>,
    Query(q): Query<EsRepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let list = state
        .db
        .list_es_saved_queries(&q.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "queries": list })))
}

async fn es_create_saved_query(
    State(state): State<AppState>,
    Json(payload): Json<EsSaveQueryPayload>,
) -> Result<Json<Value>, ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let query = state
        .db
        .create_es_saved_query(
            &id,
            &payload.repo_id,
            &payload.index_pattern,
            &payload.label,
            &payload.question,
            &payload.query_template,
            &payload.keywords,
        )
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "query": query })))
}

async fn es_delete_saved_query(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .db
        .delete_es_saved_query(&id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct EsRunSavedQueryPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "timeRangeMinutes")]
    time_range_minutes: Option<i64>,
}

async fn es_run_saved_query(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<EsRunSavedQueryPayload>,
) -> Result<Json<Value>, ApiError> {
    let saved = state
        .db
        .get_es_saved_query(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    let time_range = payload.time_range_minutes.unwrap_or(60);
    let inv_id = uuid::Uuid::new_v4().to_string();

    let inv = state
        .db
        .create_es_investigation(
            &inv_id,
            &payload.repo_id,
            &payload.account_id,
            &saved.index_pattern,
            &saved.question,
            time_range,
        )
        .map_err(ApiError::internal)?;

    let _ = state.db.increment_es_saved_query_use_count(&id);

    let account = state
        .db
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found"))?;
    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);

    let db = state.db.clone();
    let query_template = saved.query_template.clone();
    let index_pattern = saved.index_pattern.clone();

    tokio::spawn(async move {
        let es = EsClient::from_config(&config);

        let query_dsl: Value = match serde_json::from_str(&query_template) {
            Ok(v) => v,
            Err(e) => {
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "failed",
                    None,
                    None,
                    Some(&format!("Invalid saved query template: {}", e)),
                );
                return;
            }
        };

        match es.search(&index_pattern, &query_dsl, 200).await {
            Ok(result) => {
                let error_logs: Vec<investigator::LogEntry> = result
                    .hits
                    .iter()
                    .map(investigator::LogEntry::from_hit)
                    .collect();

                let inv_result = investigator::InvestigationResult {
                    phase1_query: query_dsl.clone(),
                    phase1_reasoning: "Saved query (agent skipped)".to_string(),
                    relevant_files: vec![],
                    correlation_id_field: String::new(),
                    error_logs,
                    correlation_ids: vec![],
                    trace_logs: std::collections::HashMap::new(),
                    analysis: None,
                };

                let result_json = serde_json::to_value(&inv_result).unwrap_or_default();
                let status = if inv_result.error_logs.is_empty() {
                    "no_results"
                } else {
                    "logs_ready"
                };
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    status,
                    Some(&result_json),
                    Some(&query_template),
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_es_investigation_status(
                    &inv_id,
                    "failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
            }
        }
    });

    Ok(Json(json!({ "id": inv.id, "status": inv.status })))
}
