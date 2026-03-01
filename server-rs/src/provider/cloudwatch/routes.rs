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
use crate::provider::cloudwatch::{aws_client::AwsClient, investigator};

pub fn cloudwatch_routes() -> Router<AppState> {
    Router::new()
        .route("/api/cloudwatch/investigate", post(cw_investigate))
        .route("/api/cloudwatch/investigations/{id}", get(cw_get_investigation))
        .route("/api/cloudwatch/investigations/{id}/analyze", post(cw_analyze))
        .route("/api/cloudwatch/investigations/{id}/regenerate", post(cw_regenerate))
        .route("/api/cloudwatch/investigations/{id}/create-task", post(cw_create_task))
        .route("/api/cloudwatch/investigations", get(cw_list_investigations))
        .route("/api/cloudwatch/saved-queries", get(cw_list_saved_queries).post(cw_create_saved_query))
        .route("/api/cloudwatch/saved-queries/{id}", axum::routing::delete(cw_delete_saved_query))
        .route("/api/cloudwatch/saved-queries/{id}/run", post(cw_run_saved_query))
}

#[derive(Debug, Deserialize)]
struct CwInvestigatePayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "logGroup")]
    log_group: String,
    question: String,
    #[serde(rename = "timeRangeMinutes")]
    time_range_minutes: Option<i64>,
}

async fn cw_investigate(
    State(state): State<AppState>,
    Json(payload): Json<CwInvestigatePayload>,
) -> Result<Json<Value>, ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let time_range = payload.time_range_minutes.unwrap_or(60);

    let inv = state
        .db
        .create_investigation(
            &id,
            &payload.repo_id,
            &payload.account_id,
            &payload.log_group,
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
    let log_group = payload.log_group.clone();
    let repo_path = repo.path.clone();

    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Handle::current();
        let access_key = config["access_key_id"].as_str().unwrap_or_default();
        let secret_key = config["secret_access_key"].as_str().unwrap_or_default();
        let region = config["region"].as_str().unwrap_or_default();
        let aws = AwsClient::new(access_key, secret_key, region);

        let req = investigator::InvestigationRequest {
            question: question.clone(),
            log_group: log_group.clone(),
            time_range_minutes: time_range,
            repo_path: repo_path.clone(),
            agent_command,
        };

        let result = rt.block_on(investigator::run_phase1(&req, &aws));

        match result {
            Ok(inv_result) => {
                let result_json = serde_json::to_value(&inv_result).unwrap_or_default();
                let status = if inv_result.error_logs.is_empty() {
                    "no_results"
                } else {
                    "logs_ready"
                };
                let _ = db.update_investigation_status(
                    &inv_id,
                    status,
                    Some(&result_json),
                    Some(&inv_result.phase1_query),
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_investigation_status(
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

async fn cw_get_investigation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;
    Ok(Json(json!({ "investigation": inv })))
}

#[derive(Debug, Deserialize)]
struct CwRepoQuery {
    repo_id: String,
}

async fn cw_list_investigations(
    State(state): State<AppState>,
    Query(q): Query<CwRepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let list = state
        .db
        .list_investigations(&q.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "investigations": list })))
}

async fn cw_analyze(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    if inv.status != "logs_ready" {
        return Err(ApiError::bad_request(format!(
            "Investigation status is '{}', expected 'logs_ready'",
            inv.status
        )));
    }

    state
        .db
        .update_investigation_status(&id, "analyzing", None, None, None)
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
                    let _ = db.update_investigation_status(
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
                let _ = db.update_investigation_status(
                    &inv_id,
                    "completed",
                    Some(&updated_json),
                    None,
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_investigation_status(
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

async fn cw_regenerate(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    state
        .db
        .update_investigation_status(&id, "running", Some(&json!({})), None, None)
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
        let access_key = config["access_key_id"].as_str().unwrap_or_default();
        let secret_key = config["secret_access_key"].as_str().unwrap_or_default();
        let region = config["region"].as_str().unwrap_or_default();
        let aws = AwsClient::new(access_key, secret_key, region);

        let req = investigator::InvestigationRequest {
            question: inv.question.clone(),
            log_group: inv.log_group.clone(),
            time_range_minutes: inv.time_range_minutes,
            repo_path: repo.path.clone(),
            agent_command,
        };

        match rt.block_on(investigator::run_phase1(&req, &aws)) {
            Ok(inv_result) => {
                let result_json = serde_json::to_value(&inv_result).unwrap_or_default();
                let status = if inv_result.error_logs.is_empty() {
                    "no_results"
                } else {
                    "logs_ready"
                };
                let _ = db.update_investigation_status(
                    &inv_id,
                    status,
                    Some(&result_json),
                    Some(&inv_result.phase1_query),
                    None,
                );
            }
            Err(e) => {
                let _ = db.update_investigation_status(
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

async fn cw_create_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let inv = state
        .db
        .get_investigation(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    let inv_result: investigator::InvestigationResult =
        serde_json::from_value(inv.result_json.clone())
            .map_err(|e| ApiError::bad_request(format!("Failed to parse result: {}", e)))?;

    let description = investigator::build_task_description(&inv.question, &inv_result);
    let title = format!(
        "[CW] {}",
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
        .set_investigation_linked_task(&id, &task.id)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "task": { "id": task.id, "title": task.title } })))
}

// ── Saved Queries ──

#[derive(Debug, Deserialize)]
struct CwSaveQueryPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "logGroup")]
    log_group: String,
    label: String,
    question: String,
    #[serde(rename = "queryTemplate")]
    query_template: String,
    #[serde(default)]
    keywords: String,
}

async fn cw_list_saved_queries(
    State(state): State<AppState>,
    Query(q): Query<CwRepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let list = state
        .db
        .list_saved_queries(&q.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "queries": list })))
}

async fn cw_create_saved_query(
    State(state): State<AppState>,
    Json(payload): Json<CwSaveQueryPayload>,
) -> Result<Json<Value>, ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let query = state
        .db
        .create_saved_query(
            &id,
            &payload.repo_id,
            &payload.log_group,
            &payload.label,
            &payload.question,
            &payload.query_template,
            &payload.keywords,
        )
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "query": query })))
}

async fn cw_delete_saved_query(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .db
        .delete_saved_query(&id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct CwRunSavedQueryPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "timeRangeMinutes")]
    time_range_minutes: Option<i64>,
}

async fn cw_run_saved_query(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<CwRunSavedQueryPayload>,
) -> Result<Json<Value>, ApiError> {
    let saved = state
        .db
        .get_saved_query(&id)
        .map_err(|e| ApiError::not_found(e.to_string()))?;

    let time_range = payload.time_range_minutes.unwrap_or(60);
    let inv_id = uuid::Uuid::new_v4().to_string();

    let inv = state
        .db
        .create_investigation(
            &inv_id,
            &payload.repo_id,
            &payload.account_id,
            &saved.log_group,
            &saved.question,
            time_range,
        )
        .map_err(ApiError::internal)?;

    let _ = state.db.increment_saved_query_use_count(&id);

    let account = state
        .db
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found"))?;
    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);

    let db = state.db.clone();
    let query_template = saved.query_template.clone();

    tokio::spawn(async move {
        let access_key = config["access_key_id"].as_str().unwrap_or_default();
        let secret_key = config["secret_access_key"].as_str().unwrap_or_default();
        let region = config["region"].as_str().unwrap_or_default();
        let aws = AwsClient::new(access_key, secret_key, region);

        let now = chrono::Utc::now().timestamp();
        let start = now - (time_range * 60);

        match aws
            .start_query(&saved.log_group, &query_template, start, now)
            .await
        {
            Ok(query_id) => {
                let max_wait = std::time::Duration::from_secs(120);
                let poll_start = std::time::Instant::now();
                loop {
                    match aws.get_query_results(&query_id).await {
                        Ok(result) => match result.status.as_str() {
                            "Complete" => {
                                let mut error_logs = Vec::new();
                                for row in &result.results {
                                    let mut entry = investigator::LogEntry {
                                        timestamp: String::new(),
                                        message: String::new(),
                                        log_stream: String::new(),
                                    };
                                    for field in row {
                                        match field.field.as_str() {
                                            "@timestamp" => {
                                                entry.timestamp = field.value.clone()
                                            }
                                            "@message" => entry.message = field.value.clone(),
                                            "@logStream" => {
                                                entry.log_stream = field.value.clone()
                                            }
                                            _ => {}
                                        }
                                    }
                                    error_logs.push(entry);
                                }

                                let inv_result = investigator::InvestigationResult {
                                    phase1_query: query_template.clone(),
                                    phase1_reasoning: "Saved query (agent skipped)".to_string(),
                                    relevant_files: vec![],
                                    correlation_id_field: String::new(),
                                    error_logs,
                                    correlation_ids: vec![],
                                    trace_logs: std::collections::HashMap::new(),
                                    analysis: None,
                                };

                                let result_json =
                                    serde_json::to_value(&inv_result).unwrap_or_default();
                                let status = if inv_result.error_logs.is_empty() {
                                    "no_results"
                                } else {
                                    "logs_ready"
                                };
                                let _ = db.update_investigation_status(
                                    &inv_id,
                                    status,
                                    Some(&result_json),
                                    Some(&query_template),
                                    None,
                                );
                                break;
                            }
                            "Failed" | "Cancelled" | "Timeout" => {
                                let _ = db.update_investigation_status(
                                    &inv_id,
                                    "failed",
                                    None,
                                    None,
                                    Some(&format!("CW query status: {}", result.status)),
                                );
                                break;
                            }
                            _ => {
                                if poll_start.elapsed() > max_wait {
                                    let _ = db.update_investigation_status(
                                        &inv_id,
                                        "failed",
                                        None,
                                        None,
                                        Some("CW query timed out"),
                                    );
                                    break;
                                }
                                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                            }
                        },
                        Err(e) => {
                            let _ = db.update_investigation_status(
                                &inv_id,
                                "failed",
                                None,
                                None,
                                Some(&e.to_string()),
                            );
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                let _ = db.update_investigation_status(
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
