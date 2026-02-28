mod db;
mod discovery;
mod executor;
mod models;
mod msg_store;
mod planner;
mod process_manager;
mod provider;

use std::{
    convert::Infallible,
    env,
    fs::{self, File, OpenOptions},
    io::Write,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{self, KeepAlive, Sse},
    },
    routing::{get, post},
};
use db::Db;
use directories::ProjectDirs;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    discovery::discover_agent_profiles,
    executor::{
        save_plan_artifact, spawn_agent,
        detect_base_branch, apply_branch_to_base_unstaged, apply_worktree_to_base_unstaged,
        create_worktree, ApplyError,
    },
    provider::jira::JiraClient,
    models::{CreateTaskPayload, PlanJob, TaskWithPayload},
    msg_store::{LogMsg, MsgStore},
    planner::{
        generate_plan_and_tasklist_with_agent_strict, validate_plan_payload,
        validate_tasklist_payload,
    },
    process_manager::ProcessManager,
    provider::ProviderRegistry,
};

use command_group::AsyncCommandGroup;
use tokio::io::AsyncBufReadExt as MainAsyncBufReadExt;
use tokio::io::AsyncWriteExt as MainAsyncWriteExt;

#[derive(Clone)]
struct AppState {
    db: Arc<Db>,
    process_manager: Arc<ProcessManager>,
    registry: Arc<ProviderRegistry>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_path = resolve_db_path()?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!("failed to create app data directory: {}", parent.display())
        })?;
    }
    let db = Arc::new(Db::new(db_path));
    db.init()?;

    ProcessManager::recover_orphans(&db);
    if let Err(error) = db.fail_stale_running_plan_jobs() {
        eprintln!("Warning: failed to recover stale plan jobs: {}", error);
    }
    if let Err(error) = db.reset_stale_plan_generating_tasks() {
        eprintln!("Warning: failed to reset stale PLAN_GENERATING tasks: {}", error);
    }
    if let Err(error) = db.requeue_stale_running_autostart_jobs() {
        eprintln!("Warning: failed to recover stale autostart jobs: {}", error);
    }

    let process_manager = ProcessManager::new();

    let mut registry = ProviderRegistry::new();
    provider::register_all(&mut registry);

    let state = AppState {
        db,
        process_manager,
        registry: Arc::new(registry),
    };
    spawn_autostart_worker(state.clone());
    spawn_provider_sync_worker(state.clone());

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/repos", get(list_repos).post(create_repo))
        // Old Jira-specific routes removed — use /api/providers/jira/* instead
        .route("/api/tasks/sync", post(sync_tasks))
        .route("/api/tasks", get(list_tasks).post(create_task))
        .route("/api/tasks/{task_id}", axum::routing::patch(update_task).delete(delete_task_handler))
        .route("/api/tasks/{task_id}/status", axum::routing::patch(update_task_status_handler))
        .route(
            "/api/tasks/{task_id}/autostart/requeue",
            post(requeue_task_autostart),
        )
        .route(
            "/api/tasks/{task_id}/pipeline/clear",
            post(clear_task_pipeline),
        )
        .route("/api/pipeline/clear-all", post(clear_all_pipelines))
        .route("/api/plans/create", post(create_plan))
        .route("/api/plans", get(list_plans))
        .route("/api/plans/jobs/latest", get(get_latest_plan_job_for_task))
        .route("/api/plans/jobs/{job_id}", get(get_plan_job))
        .route("/api/plans/jobs/{job_id}/logs", get(stream_plan_job_logs))
        .route("/api/plans/{plan_id}/action", post(plan_action))
        .route(
            "/api/plans/{plan_id}/manual-revision",
            post(create_manual_plan_revision),
        )
        .route("/api/runs/start", post(start_run))
        .route("/api/runs/latest", get(get_latest_run_for_task))
        .route("/api/runs/{run_id}", get(get_run))
        .route("/api/runs/{run_id}/logs", get(stream_run_logs))
        .route("/api/runs/{run_id}/stop", post(stop_run))
        .route("/api/tasks/{task_id}/review", post(submit_review))
        .route("/api/tasks/{task_id}/reviews", get(list_reviews))
        .route("/api/tasks/{task_id}/complete", post(complete_task))
        .route("/api/tasks/{task_id}/apply-to-main", post(apply_to_main))
        .route("/api/agents/discover", get(discover_agents))
        .route("/api/agents", get(list_agents))
        .route("/api/agents/select", post(select_repo_agent))
        .route("/api/agents/selection", get(get_repo_agent_selection))
        // Old Sentry-specific routes removed — use /api/providers/sentry/* instead
        // Generic provider routes
        .route("/api/providers", get(list_providers))
        .route("/api/providers/{provider_id}/connect", post(provider_connect))
        .route("/api/providers/{provider_id}/accounts", get(provider_list_accounts))
        .route("/api/providers/{provider_id}/accounts/{id}", axum::routing::delete(provider_delete_account))
        .route("/api/providers/{provider_id}/accounts/{id}/resources", get(provider_list_resources))
        .route("/api/providers/{provider_id}/bind", post(provider_bind))
        .route("/api/providers/{provider_id}/bindings", get(provider_list_bindings))
        .route("/api/providers/{provider_id}/items/{repo_id}", get(provider_list_items))
        .route("/api/providers/{provider_id}/items/{id}/action", post(provider_item_action))
        .route("/api/providers/{provider_id}/items/clear/{repo_id}", post(provider_clear_items))
        .route("/api/providers/{provider_id}/items/{id}/event", get(provider_item_event))
        .route("/api/providers/{provider_id}/items/{id}/create-task", post(provider_create_task_from_item))
        .route("/api/providers/{provider_id}/sync/{repo_id}", post(provider_manual_sync))
        .route("/api/fs/list", get(fs_list))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(4310);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Rust local agent API running on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_db_path() -> anyhow::Result<PathBuf> {
    if let Ok(override_dir) = env::var("APP_DATA_DIR") {
        return Ok(PathBuf::from(override_dir).join("agent.db"));
    }
    let project_dirs = ProjectDirs::from("", "", "jira-approval-local-agent")
        .context("unable to resolve app data directory")?;
    Ok(project_dirs.data_dir().join("agent.db"))
}

async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
      "ok": true,
      "dbPath": state.db.db_path_string()
    })))
}

async fn bootstrap(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let repos = state.db.list_repos().map_err(ApiError::internal)?;
    let agent_profiles = state.db.list_agent_profiles().map_err(ApiError::internal)?;

    // Provider-based data
    let provider_metas = state.registry.all_metas();
    let mut provider_accounts: serde_json::Map<String, Value> = serde_json::Map::new();
    for meta in &provider_metas {
        let accounts = state
            .db
            .list_provider_accounts(meta.id)
            .map_err(ApiError::internal)?;
        let provider = state.registry.get(meta.id);
        let masked: Vec<Value> = accounts
            .into_iter()
            .map(|a| {
                let config: Value =
                    serde_json::from_str(&a.config_json).unwrap_or(Value::Null);
                let masked_config = provider
                    .map(|p| p.mask_account(config.clone()))
                    .unwrap_or(config);
                json!({
                    "id": a.id,
                    "providerId": a.provider_id,
                    "displayName": a.display_name,
                    "config": masked_config,
                    "createdAt": a.created_at,
                    "updatedAt": a.updated_at,
                })
            })
            .collect();
        provider_accounts.insert(meta.id.to_string(), json!(masked));
    }

    let provider_item_counts = state
        .db
        .count_all_pending_provider_items()
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
      "repos": repos,
      "agentProfiles": agent_profiles,
      "providers": provider_metas,
      "providerAccounts": provider_accounts,
      "providerItemCounts": provider_item_counts
    })))
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

async fn sync_tasks(
    State(state): State<AppState>,
    Json(payload): Json<SyncTasksPayload>,
) -> Result<Json<Value>, ApiError> {
    // Find Jira binding from generic provider tables
    let bindings = state
        .db
        .list_provider_bindings_for_repo(&payload.repo_id)
        .map_err(ApiError::internal)?;
    let binding = bindings
        .iter()
        .find(|b| b.provider_id == "jira")
        .ok_or_else(|| ApiError::bad_request("Repo is not bound to a Jira board."))?;
    let account = state
        .db
        .get_provider_account(&binding.provider_account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Invalid binding account."))?;
    let resource = state
        .db
        .get_provider_resource(&binding.provider_resource_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Invalid binding resource."))?;

    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let base_url = config["base_url"].as_str().unwrap_or_default();
    let email = config["email"].as_str().unwrap_or_default();
    let api_token = config["api_token"].as_str().unwrap_or_default();

    let client = JiraClient::new(base_url, email, api_token);
    let had_jira_tasks_before = state
        .db
        .list_tasks_by_repo(&payload.repo_id)
        .map_err(ApiError::internal)?
        .iter()
        .any(|task| task.source == "jira");
    let issues = client
        .fetch_assigned_board_issues(&resource.external_id, None)
        .await
        .map_err(ApiError::bad_request_from)?;
    let sync_result = state
        .db
        .upsert_tasks(&payload.repo_id, &account.id, &resource.id, &issues)
        .map_err(ApiError::internal)?;
    let tasks = state
        .db
        .list_tasks_by_repo(&payload.repo_id)
        .map_err(ApiError::internal)?;

    let task_index = tasks
        .iter()
        .map(|task| (task.id.clone(), task))
        .collect::<std::collections::HashMap<_, _>>();
    for transition in &sync_result.transitions {
        let Some(task) = task_index.get(&transition.task_id) else {
            continue;
        };
        if had_jira_tasks_before && transition.is_new && is_todo_lane_status(&transition.current_status) {
            enqueue_autostart_if_enabled(&state, task, "jira_sync_new")?;
            continue;
        }

        if let Some(previous) = transition.previous_status.as_deref() {
            if !is_todo_lane_status(previous) && is_todo_lane_status(&transition.current_status) {
                enqueue_autostart_if_enabled(&state, task, "jira_sync_todo_transition")?;
            }
        }
    }

    Ok(Json(json!({
      "synced": sync_result.synced,
      "tasks": tasks
    })))
}

async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let tasks = state
        .db
        .list_tasks_by_repo(&query.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "tasks": tasks })))
}

async fn create_task(
    State(state): State<AppState>,
    Json(payload): Json<CreateTaskPayload>,
) -> Result<Json<Value>, ApiError> {
    if payload.title.trim().is_empty() {
        return Err(ApiError::bad_request("Title is required."));
    }
    if state
        .db
        .get_repo_by_id(&payload.repo_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Repo not found."));
    }
    let task = state
        .db
        .create_manual_task(&payload)
        .map_err(ApiError::internal)?;
    if is_todo_lane_status(&task.status) {
        enqueue_autostart_if_enabled(&state, &task, "task_created")?;
    }
    Ok(Json(json!({ "task": task })))
}

async fn update_task(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Json(payload): Json<UpdateTaskPayload>,
) -> Result<Json<Value>, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .unwrap_or(task.title.as_str())
        .to_string();
    if title.is_empty() {
        return Err(ApiError::bad_request("Title cannot be empty."));
    }

    let description = match payload.description {
        Some(Some(value)) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        Some(None) => None,
        None => task.description.clone(),
    };

    let priority = match payload.priority {
        Some(Some(value)) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        Some(None) => None,
        None => task.priority.clone(),
    };

    let require_plan = payload.require_plan.unwrap_or(task.require_plan);
    let auto_approve_plan = payload.auto_approve_plan.unwrap_or(task.auto_approve_plan);
    let auto_start = payload.auto_start.unwrap_or(task.auto_start);
    let use_worktree = payload.use_worktree.unwrap_or(task.use_worktree);

    state
        .db
        .update_task_details(
            &task.id,
            &title,
            description.as_deref(),
            priority.as_deref(),
            require_plan,
            auto_start,
            auto_approve_plan,
            use_worktree,
        )
        .map_err(ApiError::internal)?;

    let updated = state
        .db
        .get_task_by_id(&task.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found after update."))?;

    let changed_autostart_related = task.auto_start != updated.auto_start
        || task.auto_approve_plan != updated.auto_approve_plan
        || task.require_plan != updated.require_plan;
    if changed_autostart_related && updated.auto_start && is_todo_lane_status(&updated.status) {
        enqueue_autostart_if_enabled(&state, &updated, "task_updated")?;
    }

    Ok(Json(json!({ "task": updated })))
}

async fn update_task_status_handler(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Json(payload): Json<UpdateTaskStatusPayload>,
) -> Result<Json<Value>, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    let status = payload.status.trim();
    if status.is_empty() {
        return Err(ApiError::bad_request("Status is required."));
    }

    state
        .db
        .update_task_status(&task.id, status)
        .map_err(ApiError::internal)?;

    let updated = state
        .db
        .get_task_by_id(&task.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found after status update."))?;
    if !is_todo_lane_status(&task.status) && is_todo_lane_status(&updated.status) {
        enqueue_autostart_if_enabled(&state, &updated, "status_to_todo")?;
    }
    Ok(Json(json!({ "task": updated })))
}

async fn requeue_task_autostart(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if !is_todo_lane_status(&task.status) {
        return Err(ApiError::bad_request(
            "Task must be in To Do lane to requeue autostart.",
        ));
    }

    let job = state
        .db
        .enqueue_autostart_job(&task.id, "manual_requeue")
        .map_err(ApiError::internal)?;
    let _ = state.db.update_task_pipeline_state(&task.id, None);

    Ok(Json(json!({ "job": job })))
}

async fn delete_task_handler(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if !is_todo_lane_status(&task.status) {
        return Err(ApiError::bad_request(
            "Only tasks in the To Do lane can be deleted.",
        ));
    }

    // Clear any pending/running pipeline jobs before deleting
    let _ = state.db.clear_task_pipeline(&path.task_id);

    state
        .db
        .delete_task(&path.task_id)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "deleted": true })))
}

async fn clear_task_pipeline(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let _task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    let result = state
        .db
        .clear_task_pipeline(&path.task_id)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
        "cleared": true,
        "plan_jobs_failed": result.plan_jobs_failed,
        "autostart_jobs_failed": result.autostart_jobs_failed,
        "task_reset": result.task_reset
    })))
}

async fn clear_all_pipelines(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    let result = state
        .db
        .clear_all_pipelines()
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
        "cleared": true,
        "plan_jobs_failed": result.plan_jobs_failed,
        "autostart_jobs_failed": result.autostart_jobs_failed,
        "task_reset": result.task_reset
    })))
}

async fn create_plan(
    State(state): State<AppState>,
    Json(payload): Json<CreatePlanPayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let task = state
        .db
        .get_task_by_id(&payload.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;
    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Task has no valid repo."))?;
    let agent_command = resolve_agent_command(&state, &task.repo_id).ok_or_else(|| {
        ApiError::bad_request("Select an AI profile for this repo before plan generation.")
    })?;

    let mut job = state
        .db
        .create_plan_job(&task.id, "manual", payload.revision_comment.as_deref())
        .map_err(ApiError::internal)?;

    let store_key = plan_store_key(&job.id);
    let has_store = state.process_manager.get_store(&store_key).await.is_some();

    if !has_store && job.status == "running" {
        state
            .db
            .fail_plan_job(
                &job.id,
                "Recovered stale running plan job (missing live process store).",
                job.plan_id.as_deref(),
            )
            .map_err(ApiError::internal)?;
        job = state
            .db
            .create_plan_job(&task.id, "manual", payload.revision_comment.as_deref())
            .map_err(ApiError::internal)?;
    }

    if job.status == "pending" && state.process_manager.get_store(&plan_store_key(&job.id)).await.is_none() {
        let store = MsgStore::new();
        state
            .process_manager
            .register_store(&plan_store_key(&job.id), store.clone())
            .await;
        spawn_plan_generation_job(
            state.clone(),
            job.clone(),
            task.clone(),
            repo.path.clone(),
            agent_command,
            "manual",
            store,
            None,
        );
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
          "job": job
        })),
    ))
}

fn plan_store_key(job_id: &str) -> String {
    format!("plan-job:{job_id}")
}

fn sanitize_log_segment(input: &str) -> String {
    input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn open_plan_debug_log_file(repo_path: &str, issue_key: &str, job_id: &str) -> (Option<File>, Option<String>) {
    let issue_segment = sanitize_log_segment(issue_key);
    let job_segment = sanitize_log_segment(job_id);
    let mut job_short = if job_segment.is_empty() {
        "job".to_string()
    } else {
        job_segment
    };
    if job_short.len() > 12 {
        job_short.truncate(12);
    }
    let issue_short = if issue_segment.is_empty() {
        "task".to_string()
    } else {
        issue_segment
    };

    let log_dir = PathBuf::from(repo_path).join(".local-agent").join("plan-logs");
    if let Err(error) = fs::create_dir_all(&log_dir) {
        eprintln!("Warning: failed to create plan log dir {}: {error}", log_dir.display());
        return (None, None);
    }

    let log_path = log_dir.join(format!("{issue_short}-{job_short}.log"));
    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(file) => (Some(file), Some(log_path.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!("Warning: failed to open plan log file {}: {error}", log_path.display());
            (None, None)
        }
    }
}

fn write_plan_debug_log(log_file: &mut Option<File>, message: &str) {
    let Some(file) = log_file.as_mut() else {
        return;
    };
    let ts = chrono::Utc::now().to_rfc3339();
    let _ = writeln!(file, "[{ts}] {message}");
    let _ = file.flush();
}

fn spawn_plan_generation_job(
    state: AppState,
    job: PlanJob,
    task: TaskWithPayload,
    repo_path: String,
    agent_command: String,
    generation_mode: &str,
    store: Arc<MsgStore>,
    autostart_job_id: Option<String>,
) {
    let generation_mode = generation_mode.to_string();
    tokio::spawn(async move {
        let (mut debug_log_file, debug_log_path) =
            open_plan_debug_log_file(&repo_path, &task.jira_issue_key, &job.id);
        write_plan_debug_log(
            &mut debug_log_file,
            &format!(
                "plan job started: job_id={} task_id={} issue_key={} mode={} generation_mode={} repo_path={}",
                job.id, task.id, task.jira_issue_key, job.mode, generation_mode, repo_path
            ),
        );
        write_plan_debug_log(
            &mut debug_log_file,
            &format!("agent command: {}", agent_command),
        );

        let _ = state.db.mark_plan_job_running(&job.id);
        let _ = state.db.touch_plan_job(&job.id);
        store
            .push(LogMsg::AgentText("Plan pipeline started.".to_string()))
            .await;
        if let Some(path) = debug_log_path.as_deref() {
            let message = format!("Plan debug log file: {path}");
            store.push(LogMsg::AgentText(message.clone())).await;
            write_plan_debug_log(&mut debug_log_file, &message);
        }

        // Macro-like closure to fail the autostart job on plan failure
        let fail_autostart = |msg: &str| {
            if let Some(ref ast_job_id) = autostart_job_id {
                let _ = state.db.fail_autostart_job(ast_job_id, msg, None, None);
            }
        };

        let target_version = match state.db.get_next_plan_version(&task.id) {
            Ok(version) => version,
            Err(error) => {
                let message = format!("plan pipeline failed before generation: {error}");
                write_plan_debug_log(&mut debug_log_file, &message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&message));
                let _ = state.db.fail_plan_job(&job.id, &message, None);
                fail_autostart(&message);
                store.push_stderr(message).await;
                store.push_finished(None, "failed").await;
                return;
            }
        };

        let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<LogMsg>();
        let task_for_gen = task.clone();
        let repo_for_gen = repo_path.clone();
        let cmd_for_gen = agent_command.clone();
        let revision = job.revision_comment.clone();
        let previous_session_id = if revision.is_some() {
            state.db.get_latest_completed_plan_job_session(&task.id).ok().flatten()
        } else {
            None
        };
        let mut generation = tokio::task::spawn_blocking(move || {
            let progress_cb = |msg: LogMsg| {
                let _ = progress_tx.send(msg);
            };
            generate_plan_and_tasklist_with_agent_strict(
                &repo_for_gen,
                &task_for_gen,
                &cmd_for_gen,
                revision.as_deref(),
                target_version,
                Some(&progress_cb),
                previous_session_id.as_deref(),
            )
        });

        let start = Instant::now();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(8));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        let generated = loop {
            tokio::select! {
                join_result = &mut generation => {
                    break join_result;
                }
                maybe_progress = progress_rx.recv() => {
                    if let Some(msg) = maybe_progress {
                        let _ = state.db.touch_plan_job(&job.id);
                        write_plan_debug_log(
                            &mut debug_log_file,
                            &format!("[progress] {:?}", msg),
                        );
                        store.push(msg).await;
                    }
                }
                _ = heartbeat.tick() => {
                    let elapsed = start.elapsed().as_secs();
                    let _ = state.db.touch_plan_job(&job.id);
                    let heartbeat_msg = format!(
                        "Plan generation is running... {}s elapsed.",
                        elapsed
                    );
                    write_plan_debug_log(
                        &mut debug_log_file,
                        &format!("[heartbeat] {}", heartbeat_msg),
                    );
                    store.push(LogMsg::Thinking(heartbeat_msg)).await;
                }
            }
        };

        let generated = match generated {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                let message = format!("plan pipeline failed: {error}");
                write_plan_debug_log(&mut debug_log_file, &message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&message));
                let _ = state.db.fail_plan_job(&job.id, &message, None);
                fail_autostart(&message);
                store.push_stderr(message).await;
                store.push_finished(None, "failed").await;
                return;
            }
            Err(error) => {
                let message = format!("plan pipeline worker failed: {error}");
                write_plan_debug_log(&mut debug_log_file, &message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&message));
                let _ = state.db.fail_plan_job(&job.id, &message, None);
                fail_autostart(&message);
                store.push_stderr(message).await;
                store.push_finished(None, "failed").await;
                return;
            }
        };

        let plan = match state.db.create_plan(
            &task.id,
            "drafted",
            &generated.markdown,
            &generated.plan_json,
            &generated.tasklist_json,
            1,
            &generation_mode,
            None,
            "agent",
        ) {
            Ok(plan) => plan,
            Err(error) => {
                let message = format!("plan save failed: {error}");
                write_plan_debug_log(&mut debug_log_file, &message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&message));
                let _ = state.db.fail_plan_job(&job.id, &message, None);
                fail_autostart(&message);
                store.push_stderr(message).await;
                store.push_finished(None, "failed").await;
                return;
            }
        };

        if let Err(error) = state.db.update_task_status(&task.id, "PLAN_DRAFTED") {
            let message = format!("task status update failed: {error}");
            write_plan_debug_log(&mut debug_log_file, &message);
            let _ = state
                .db
                .update_task_pipeline_state(&task.id, Some(&message));
            let _ = state.db.fail_plan_job(&job.id, &message, Some(&plan.id));
            fail_autostart(&message);
            store.push_stderr(message).await;
            store.push_finished(None, "failed").await;
            return;
        }

        let _ = state.db.update_task_pipeline_state(&task.id, None);
        let _ = state.db.complete_plan_job(&job.id, Some(&plan.id), generated.agent_session_id.as_deref());
        store
            .push(LogMsg::AgentText(format!(
                "Plan version v{} created.",
                plan.version
            )))
            .await;
        write_plan_debug_log(
            &mut debug_log_file,
            &format!("plan version created: v{} id={}", plan.version, plan.id),
        );

        // Track whether the autostart job was already finalized in a sub-path
        let mut autostart_handled = false;

        if task.auto_approve_plan {
            let _ = state.db.add_plan_action(
                &plan.id,
                "approve",
                Some("auto-approved by task setting"),
                "system:auto",
            );
            let _ = state.db.update_plan_status(&plan.id, "approved");
            let _ = state.db.update_task_status(&task.id, "PLAN_APPROVED");
            store
                .push(LogMsg::AgentText(
                    "Plan auto-approved by task settings.".to_string(),
                ))
                .await;
            write_plan_debug_log(&mut debug_log_file, "plan auto-approved by task settings");
            if task.auto_start {
                if let Some(ref ast_job_id) = autostart_job_id {
                    // Directly start run from within the background task
                    autostart_handled = true;
                    store
                        .push(LogMsg::AgentText(
                            "Starting run after auto-approval...".to_string(),
                        ))
                        .await;
                    write_plan_debug_log(&mut debug_log_file, "starting run after auto-approval (inline)");
                    match start_run(
                        State(state.clone()),
                        Json(StartRunPayload {
                            plan_id: Some(plan.id.clone()),
                            task_id: None,
                            profile_id: None,
                        }),
                    )
                    .await
                    {
                        Ok((_, run_payload)) => {
                            let run_id = run_payload
                                .0
                                .get("run")
                                .and_then(|r| r.get("id"))
                                .and_then(Value::as_str)
                                .map(ToString::to_string);
                            let _ = state.db.complete_autostart_job(
                                ast_job_id,
                                Some(&plan.id),
                                run_id.as_deref(),
                            );
                            store
                                .push(LogMsg::AgentText(format!(
                                    "Run started successfully (run_id={}).",
                                    run_id.as_deref().unwrap_or("?")
                                )))
                                .await;
                            write_plan_debug_log(
                                &mut debug_log_file,
                                &format!("autostart job completed with run_id={}", run_id.as_deref().unwrap_or("?")),
                            );
                        }
                        Err(error) if error.status == StatusCode::CONFLICT => {
                            // Repo has an active run — requeue so worker retries later
                            let _ = state.db.requeue_autostart_job(
                                ast_job_id,
                                Some(&format!("conflict after auto-approve: {}", error.message)),
                            );
                            store
                                .push(LogMsg::AgentText(format!(
                                    "Run conflict, requeued: {}",
                                    error.message
                                )))
                                .await;
                            write_plan_debug_log(
                                &mut debug_log_file,
                                &format!("autostart requeued due to conflict: {}", error.message),
                            );
                        }
                        Err(error) => {
                            let msg = format!("autostart run failed after auto-approve: {}", error.message);
                            let _ = state.db.fail_autostart_job(
                                ast_job_id,
                                &msg,
                                Some(&plan.id),
                                None,
                            );
                            store.push(LogMsg::AgentText(msg.clone())).await;
                            write_plan_debug_log(&mut debug_log_file, &msg);
                        }
                    }
                } else {
                    // Manual flow with auto_approve+auto_start but no autostart_job_id:
                    // enqueue autostart job for the worker to pick up
                    let _ = state.db.enqueue_autostart_job(&task.id, "auto_approve");
                    store
                        .push(LogMsg::AgentText(
                            "Autostart job enqueued after auto-approval.".to_string(),
                        ))
                        .await;
                    write_plan_debug_log(
                        &mut debug_log_file,
                        "autostart job enqueued after auto-approval",
                    );
                }
            }
        }

        // If autostart_job_id is present but wasn't handled above (e.g. plan drafted
        // without auto-approve, or auto-approved but auto_start disabled), complete it.
        // A new autostart job will be enqueued when the user manually approves the plan.
        if let Some(ref ast_job_id) = autostart_job_id {
            if !autostart_handled {
                let _ = state.db.complete_autostart_job(
                    ast_job_id,
                    Some(&plan.id),
                    None,
                );
                write_plan_debug_log(
                    &mut debug_log_file,
                    "autostart job completed (plan generated, awaiting manual action)",
                );
            }
        }

        write_plan_debug_log(&mut debug_log_file, "plan job completed successfully");
        store.push_finished(Some(0), "done").await;
    });
}

async fn get_latest_plan_job_for_task(
    State(state): State<AppState>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let job = state
        .db
        .get_latest_plan_job_by_task(&query.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "job": job })))
}

async fn get_plan_job(
    State(state): State<AppState>,
    Path(path): Path<PlanJobPath>,
) -> Result<Json<Value>, ApiError> {
    let job = state
        .db
        .get_plan_job_by_id(&path.job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan job not found."))?;
    Ok(Json(json!({ "job": job })))
}

async fn stream_plan_job_logs(
    State(state): State<AppState>,
    Path(path): Path<PlanJobPath>,
) -> Result<Response, ApiError> {
    let job = state
        .db
        .get_plan_job_by_id(&path.job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan job not found."))?;

    if let Some(store) = state.process_manager.get_store(&plan_store_key(&path.job_id)).await {
        let stream: SseStream = Box::pin(store.sse_stream().await);
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    let mut sse_events: Vec<Result<sse::Event, Infallible>> = vec![Ok(
        sse::Event::default().event("db_event").data(
            json!({
                "type": "status",
                "payload": { "message": format!("Plan job status: {}", job.status) }
            })
            .to_string(),
        ),
    )];

    if let Some(error) = job.error.as_deref() {
        sse_events.push(Ok(sse::Event::default().event("stderr").data(error.to_string())));
    }

    if job.status == "running" || job.status == "pending" {
        let stream: SseStream = Box::pin(
            futures::stream::iter(sse_events)
                .chain(futures::stream::pending::<Result<sse::Event, Infallible>>()),
        );
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    sse_events.push(Ok(sse::Event::default().event("finished").data(
        json!({ "exitCode": if job.status == "done" { Some(0) } else { None::<i32> }, "status": job.status }).to_string(),
    )));
    let stream: SseStream = Box::pin(futures::stream::iter(sse_events));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

async fn list_plans(
    State(state): State<AppState>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let plans = state
        .db
        .list_plans_by_task(&query.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "plans": plans })))
}

async fn plan_action(
    State(state): State<AppState>,
    Path(path): Path<PlanPath>,
    Json(payload): Json<PlanActionPayload>,
) -> Result<Json<Value>, ApiError> {
    let existing_plan = state
        .db
        .get_plan_by_id(&path.plan_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan not found."))?;
    let task: TaskWithPayload = state
        .db
        .get_task_by_id(&existing_plan.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    state
        .db
        .add_plan_action(
            &path.plan_id,
            payload.action.as_str(),
            payload.comment.as_deref(),
            "user",
        )
        .map_err(ApiError::internal)?;

    match payload.action.as_str() {
        "approve" => {
            state
                .db
                .update_plan_status(&path.plan_id, "approved")
                .map_err(ApiError::internal)?;
            state
                .db
                .update_task_status(&task.id, "PLAN_APPROVED")
                .map_err(ApiError::internal)?;
            let updated_task = state
                .db
                .get_task_by_id(&task.id)
                .map_err(ApiError::internal)?
                .ok_or_else(|| ApiError::not_found("Task not found after approval."))?;
            enqueue_autostart_if_enabled(&state, &updated_task, "status_to_todo")?;
            let plan = state
                .db
                .get_plan_by_id(&path.plan_id)
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "approved", "plan": plan })))
        }
        "reject" => {
            state
                .db
                .update_plan_status(&path.plan_id, "rejected")
                .map_err(ApiError::internal)?;
            state
                .db
                .update_task_status(&task.id, "To Do")
                .map_err(ApiError::internal)?;
            let plan = state
                .db
                .get_plan_by_id(&path.plan_id)
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "rejected", "plan": plan })))
        }
        "revise" => {
            state
                .db
                .update_plan_status(&path.plan_id, "revise_requested")
                .map_err(ApiError::internal)?;
            state
                .db
                .update_task_status(&task.id, "PLAN_REVISE_REQUESTED")
                .map_err(ApiError::internal)?;
            let repo = state
                .db
                .get_repo_by_id(&task.repo_id)
                .map_err(ApiError::internal)?
                .ok_or_else(|| ApiError::bad_request("Task repo not found for revision."))?;
            let agent_command = resolve_agent_command(&state, &task.repo_id).ok_or_else(|| {
                ApiError::bad_request("Select an AI profile for this repo before plan revision.")
            })?;
            let target_version = state
                .db
                .get_next_plan_version(&task.id)
                .map_err(ApiError::internal)?;
            let comment = payload
                .comment
                .clone()
                .unwrap_or_else(|| "Please revise this plan.".to_string());
            let previous_session_id = state
                .db
                .get_latest_completed_plan_job_session(&task.id)
                .ok()
                .flatten();
            let revised = {
                let repo_path = repo.path.clone();
                let task_clone = task.clone();
                let command = agent_command.clone();
                tokio::task::spawn_blocking(move || {
                    generate_plan_and_tasklist_with_agent_strict(
                        &repo_path,
                        &task_clone,
                        &command,
                        Some(&comment),
                        target_version,
                        None,
                        previous_session_id.as_deref(),
                    )
                })
                .await
                .map_err(|e| ApiError::internal(anyhow::anyhow!("spawn error: {}", e)))?
            };
            let revised = match revised {
                Ok(value) => value,
                Err(error) => {
                    let message = format!("plan revision pipeline failed: {error}");
                    let _ = state
                        .db
                        .update_task_pipeline_state(&task.id, Some(&message));
                    return Err(ApiError::bad_request(message));
                }
            };

            let new_plan = state
                .db
                .create_plan(
                    &task.id,
                    "drafted",
                    &revised.markdown,
                    &revised.plan_json,
                    &revised.tasklist_json,
                    1,
                    "revise",
                    None,
                    "agent",
                )
                .map_err(ApiError::internal)?;
            // New plan drafted after revision
            state
                .db
                .update_task_status(&task.id, "PLAN_DRAFTED")
                .map_err(ApiError::internal)?;
            let _ = state.db.update_task_pipeline_state(&task.id, None);

            if task.auto_approve_plan {
                state
                    .db
                    .add_plan_action(
                        &new_plan.id,
                        "approve",
                        Some("auto-approved by task setting"),
                        "system:auto",
                    )
                    .map_err(ApiError::internal)?;
                state
                    .db
                    .update_plan_status(&new_plan.id, "approved")
                    .map_err(ApiError::internal)?;
                state
                    .db
                    .update_task_status(&task.id, "PLAN_APPROVED")
                    .map_err(ApiError::internal)?;
            }

            let latest_new_plan = state
                .db
                .get_plan_by_id(&new_plan.id)
                .map_err(ApiError::internal)?
                .ok_or_else(|| ApiError::not_found("Revised plan not found."))?;

            Ok(Json(json!({
              "status": "revised",
              "previousPlan": state.db.get_plan_by_id(&path.plan_id).map_err(ApiError::internal)?,
              "newPlan": latest_new_plan
            })))
        }
        _ => Err(ApiError::bad_request(
            "Unsupported action. Use approve, reject, or revise.",
        )),
    }
}

async fn create_manual_plan_revision(
    State(state): State<AppState>,
    Path(path): Path<PlanPath>,
    Json(payload): Json<ManualPlanRevisionPayload>,
) -> Result<Json<Value>, ApiError> {
    let base_plan = state
        .db
        .get_plan_by_id(&path.plan_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan not found."))?;
    let task = state
        .db
        .get_task_by_id(&base_plan.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;
    let target_version = state
        .db
        .get_next_plan_version(&task.id)
        .map_err(ApiError::internal)?;

    validate_plan_payload(&payload.plan_json, &payload.plan_markdown, &task.jira_issue_key)
        .map_err(ApiError::bad_request_from)?;
    validate_tasklist_payload(&payload.tasklist_json, &task.jira_issue_key, target_version)
        .map_err(ApiError::bad_request_from)?;

    let new_plan = state
        .db
        .create_plan(
            &task.id,
            "drafted",
            &payload.plan_markdown,
            &payload.plan_json,
            &payload.tasklist_json,
            1,
            "manual",
            None,
            "user",
        )
        .map_err(ApiError::internal)?;

    state
        .db
        .add_plan_action(
            &new_plan.id,
            "manual_revision",
            payload.comment.as_deref(),
            "user",
        )
        .map_err(ApiError::internal)?;
    state
        .db
        .update_task_status(&task.id, "PLAN_DRAFTED")
        .map_err(ApiError::internal)?;
    let _ = state.db.update_task_pipeline_state(&task.id, None);

    let latest = state
        .db
        .get_plan_by_id(&new_plan.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan not found after manual revision."))?;

    Ok(Json(json!({ "plan": latest })))
}

async fn start_run(
    State(state): State<AppState>,
    Json(payload): Json<StartRunPayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let provided_plan_id = payload
        .plan_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);
    let provided_task_id = payload
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);

    let (task, plan_id, execution_plan_markdown, execution_plan_version, execution_tasklist_json) =
        if let Some(plan_id) = provided_plan_id {
        let plan = state
            .db
            .get_plan_by_id(&plan_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::not_found("Plan not found."))?;
        let task = state
            .db
            .get_task_by_id(&plan.task_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::not_found("Task not found."))?;
        if task.require_plan && plan.status != "approved" {
            return Err(ApiError::bad_request(
                "Plan must be approved before execution.",
            ));
        }
        (
            task,
            plan.id,
            plan.plan_markdown,
            plan.version,
            plan.tasklist,
        )
    } else {
        let task_id = provided_task_id
            .ok_or_else(|| ApiError::bad_request("Provide planId or taskId to start a run."))?;
        let task = state
            .db
            .get_task_by_id(&task_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::not_found("Task not found."))?;
        if task.require_plan {
            return Err(ApiError::bad_request(
                "This task requires plan approval before execution.",
            ));
        }
        let direct_plan_markdown = format!(
            "# Direct Execution\n\nTask: {} ({})\n\nDescription:\n{}\n",
            task.jira_issue_key,
            task.title,
            task.description
                .as_deref()
                .unwrap_or("No description provided.")
        );
        let direct_plan_json = json!({
          "mode": "direct_execution",
          "taskId": task.id,
          "taskKey": task.jira_issue_key,
          "note": "require_plan is disabled for this task"
        });
        let direct_tasklist_json = json!({
          "schema_version": 1,
          "issue_key": task.jira_issue_key,
          "generated_from_plan_version": 1,
          "phases": [{
            "id": "phase-direct",
            "name": "Direct Execution",
            "description": "Single-step direct execution path",
            "order": 1,
            "tasks": [{
              "id": "direct-1",
              "title": task.title,
              "description": task.description.clone().unwrap_or_else(|| "No description provided.".to_string()),
              "blocked_by": [],
              "blocks": [],
              "affected_files": [],
              "acceptance_criteria": ["Complete the task and keep changes scoped"],
              "suggested_subagent": "general-purpose",
              "estimated_size": "M"
            }]
          }]
        });
        let plan = state
            .db
            .create_plan(
                &task.id,
                "approved",
                &direct_plan_markdown,
                &direct_plan_json,
                &direct_tasklist_json,
                1,
                "direct_execution",
                None,
                "system",
            )
            .map_err(ApiError::internal)?;
        (
            task,
            plan.id,
            plan.plan_markdown,
            plan.version,
            direct_tasklist_json,
        )
    };

    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    if state
        .db
        .has_running_run_for_repo(&repo.id)
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::conflict(
            "Another run is already active for this repository. Wait for it to finish.",
        ));
    }

    let profile = if let Some(profile_id) = payload.profile_id.as_deref().map(str::trim) {
        if profile_id.is_empty() {
            return Err(ApiError::bad_request("profileId cannot be empty."));
        }
        let profile = state
            .db
            .get_agent_profile_by_id(profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Selected agent profile no longer exists."))?;
        state
            .db
            .set_repo_agent_preference(&repo.id, profile_id)
            .map_err(ApiError::internal)?;
        profile
    } else {
        let preference = state
            .db
            .get_repo_agent_preference(&repo.id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| {
                ApiError::bad_request("Select an AI profile for this repo before run.")
            })?;
        state
            .db
            .get_agent_profile_by_id(&preference.agent_profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Selected agent profile no longer exists."))?
    };
    let agent_command = build_agent_command(&profile);

    let agent_segment = sanitize_branch_segment(&profile.provider);
    let task_segment = sanitize_branch_segment(&task.jira_issue_key);
    let branch_name = if task.use_worktree {
        format!(
            "agent/{}-{}-{}",
            if agent_segment.is_empty() { "agent".to_string() } else { agent_segment },
            if task_segment.is_empty() { "task".to_string() } else { task_segment },
            chrono::Utc::now().timestamp()
        )
    } else {
        String::new() // No branch for direct mode
    };

    let run = state
        .db
        .create_run(
            &task.id,
            &plan_id,
            "running",
            &branch_name,
            Some(&profile.id),
            None, // worktree_path set later in background task
        )
        .map_err(ApiError::internal)?;
    state
        .db
        .update_task_status(&task.id, "IN_PROGRESS")
        .map_err(ApiError::internal)?;

    state
        .db
        .add_run_event(
            &run.id,
            "run_started",
            &json!({
              "branchName": &branch_name,
              "issueKey": &task.jira_issue_key,
              "requirePlan": task.require_plan,
              "planId": &plan_id,
              "planVersion": execution_plan_version,
              "tasklistSchemaVersion": 1,
              "agentProfile": {
                "id": &profile.id,
                "provider": &profile.provider,
                "agentName": &profile.agent_name,
                "model": &profile.model,
                "command": &agent_command
              }
            }),
        )
        .map_err(ApiError::internal)?;

    // Return 202 immediately, spawn background task
    let response = json!({
        "run": {
            "id": run.id,
            "status": run.status,
            "branch_name": run.branch_name,
            "agent": {
                "id": profile.id,
                "provider": profile.provider,
                "agent_name": profile.agent_name,
                "model": profile.model
            }
        }
    });

    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let repo_path = repo.path.clone();
    let issue_key = task.jira_issue_key.clone();
    let plan_markdown = execution_plan_markdown;
    let plan_version = execution_plan_version;
    let plan_tasklist_json = execution_tasklist_json;
    let use_worktree = task.use_worktree;
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;

    tokio::spawn(async move {
        // Determine the working directory for the agent
        let agent_working_dir: String;

        if use_worktree {
            store
                .push(LogMsg::AgentText(
                    "Creating worktree for isolated execution...".to_string(),
                ))
                .await;

            // Step 1a: Create worktree (blocking git ops)
            let wt_result = {
                let rp = repo_path.clone();
                let bn = branch_name.clone();
                tokio::task::spawn_blocking(move || create_worktree(&rp, &bn)).await
            };

            match wt_result {
                Ok(Ok(wt_info)) => {
                    agent_working_dir = wt_info.worktree_path.clone();
                    // Update run with worktree_path
                    let _ = db.update_run_worktree_path(&run_id, &wt_info.worktree_path);
                    store
                        .push(LogMsg::AgentText(format!(
                            "Worktree ready at: {}",
                            wt_info.worktree_path
                        )))
                        .await;
                }
                Ok(Err(e)) => {
                    store
                        .push_stderr(format!("Run failed while creating worktree: {}", e))
                        .await;
                    store.push_finished(None, "failed").await;
                    let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
                    let _ = db.update_run_status(&run_id, "failed", true);
                    let _ = db.update_task_status(&task_id, "FAILED");
                    return;
                }
                Err(e) => {
                    store
                        .push_stderr(format!("Run failed while creating worktree: {}", e))
                        .await;
                    store.push_finished(None, "failed").await;
                    let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
                    let _ = db.update_run_status(&run_id, "failed", true);
                    let _ = db.update_task_status(&task_id, "FAILED");
                    return;
                }
            }
        } else {
            // Direct mode: agent works directly on the main repo, no branch
            store
                .push(LogMsg::AgentText(
                    "Direct mode: agent will work on current branch.".to_string(),
                ))
                .await;
            agent_working_dir = repo_path.clone();
        }

        // Save plan artifact in the agent's working directory
        let artifact_result = {
            let wd = agent_working_dir.clone();
            let ik = issue_key.clone();
            let pm_text = plan_markdown.clone();
            let pv = plan_version;
            tokio::task::spawn_blocking(move || save_plan_artifact(&wd, &ik, pv, &pm_text)).await
        };

        match artifact_result {
            Ok(Ok(artifact_path)) => {
                store
                    .push(LogMsg::AgentText(format!(
                        "Execution plan saved: {}",
                        artifact_path
                    )))
                    .await;
                let _ = db.add_run_event(&run_id, "plan_artifact_saved", &json!({ "artifactPath": artifact_path }));
            }
            _ => {
                store
                    .push_stderr("Run failed: could not save execution plan artifact.".to_string())
                    .await;
                store.push_finished(None, "failed").await;
                let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": "failed to save plan artifact" }));
                let _ = db.update_run_status(&run_id, "failed", true);
                let _ = db.update_task_status(&task_id, "FAILED");
                return;
            }
        }

        // Step 2: Build prompt
        let tasklist_pretty =
            serde_json::to_string_pretty(&plan_tasklist_json).unwrap_or_else(|_| "{}".to_string());
        let prompt = format!(
            "You are working on issue {}.\n\nTask: {}\n\nDescription: {}\n\nExecution Plan:\n{}\n\nTasklist JSON:\n{}\n\nExecution constraints:\n- Follow phase order.\n- Report progress using task IDs from tasklist.\n- If useful, use subagents/tools for parallelizable subtasks while preserving dependencies.",
            issue_key,
            task.title,
            task.description.as_deref().unwrap_or("No description"),
            plan_markdown,
            tasklist_pretty
        );

        // Step 3: Spawn agent in the appropriate working directory
        store
            .push(LogMsg::AgentText("Starting agent process...".to_string()))
            .await;
        match spawn_agent(&agent_command, &prompt, &agent_working_dir, store.clone()).await {
            Ok(child) => {
                // Record PID
                if let Some(pid) = child.id() {
                    let _ = db.update_run_pid(&run_id, pid as i64);
                }
                let _ = db.add_run_event(&run_id, "agent_spawned", &json!({
                    "command": agent_command,
                    "useWorktree": use_worktree,
                    "workingDir": &agent_working_dir
                }));

                pm.attach_child(&run_id, child).await;
                pm.spawn_exit_monitor(run_id, task_id, repo_path, agent_working_dir, db).await;
            }
            Err(e) => {
                store.push_stderr(format!("Failed to spawn agent: {}", e)).await;
                store.push_finished(None, "failed").await;
                let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
                let _ = db.update_run_status(&run_id, "failed", true);
                let _ = db.update_task_status(&task_id, "FAILED");
            }
        }
    });

    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn get_run(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
) -> Result<Json<Value>, ApiError> {
    let run = state
        .db
        .get_run_by_id(&path.run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Run not found."))?;
    let events = state
        .db
        .list_run_events(&path.run_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "run": run, "events": events })))
}

async fn get_latest_run_for_task(
    State(state): State<AppState>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let run = state
        .db
        .get_latest_run_by_task(&query.task_id)
        .map_err(ApiError::internal)?;
    if let Some(run) = run {
        let events = state
            .db
            .list_run_events(&run.id)
            .map_err(ApiError::internal)?;
        return Ok(Json(json!({ "run": run, "events": events })));
    }
    Ok(Json(json!({ "run": null, "events": [] })))
}

type SseStream = std::pin::Pin<Box<dyn futures::Stream<Item = Result<sse::Event, Infallible>> + Send>>;

async fn stream_run_logs(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
) -> Result<Response, ApiError> {
    let run = state
        .db
        .get_run_by_id(&path.run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Run not found."))?;

    // If run is live, stream from MsgStore
    if let Some(store) = state.process_manager.get_store(&path.run_id).await {
        let stream: SseStream = Box::pin(store.sse_stream().await);
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    // Run is completed — return DB events as one-shot SSE then finished
    let events = state
        .db
        .list_run_events(&path.run_id)
        .map_err(ApiError::internal)?;

    let mut sse_events: Vec<Result<sse::Event, Infallible>> = events
        .iter()
        .map(|e| {
            Ok(sse::Event::default()
                .event("db_event")
                .data(json!({ "type": e.r#type, "payload": e.payload }).to_string()))
        })
        .collect();

    if run.status == "running" {
        sse_events.push(Ok(sse::Event::default().event("db_event").data(
            json!({
                "type": "status",
                "payload": { "message": "Run is starting. Waiting for agent stream..." }
            })
            .to_string(),
        )));
        let stream: SseStream = Box::pin(
            futures::stream::iter(sse_events)
                .chain(futures::stream::pending::<Result<sse::Event, Infallible>>()),
        );
        return Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response());
    }

    sse_events.push(Ok(sse::Event::default().event("finished").data(
        json!({ "exitCode": run.exit_code, "status": run.status }).to_string(),
    )));

    let stream: SseStream = Box::pin(futures::stream::iter(sse_events));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

async fn stop_run(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
) -> Result<Json<Value>, ApiError> {
    let run = state
        .db
        .get_run_by_id(&path.run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Run not found."))?;

    if run.status != "running" {
        return Err(ApiError::bad_request("Run is not currently running."));
    }

    let killed = state.process_manager.kill_process(&path.run_id).await;
    if !killed {
        return Err(ApiError::bad_request("No running process found for this run."));
    }

    state
        .db
        .update_run_status(&path.run_id, "cancelled", true)
        .map_err(ApiError::internal)?;
    state
        .db
        .update_task_status(&run.task_id, "CANCELLED")
        .map_err(ApiError::internal)?;
    state
        .db
        .add_run_event(
            &path.run_id,
            "run_cancelled",
            &json!({ "reason": "user_requested" }),
        )
        .map_err(ApiError::internal)?;

    // Push finished to SSE so clients close
    if let Some(store) = state.process_manager.get_store(&path.run_id).await {
        store.push_finished(None, "cancelled").await;
    }

    Ok(Json(json!({ "status": "cancelled", "run_id": path.run_id })))
}

async fn submit_review(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Json(payload): Json<SubmitReviewPayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let comment = payload.comment.trim();
    if comment.is_empty() {
        return Err(ApiError::bad_request("Comment cannot be empty."));
    }

    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if task.status != "IN_REVIEW" {
        return Err(ApiError::bad_request("Task must be in IN_REVIEW status to submit feedback."));
    }

    let latest_run = state
        .db
        .get_latest_run_by_task(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("No completed run found for this task."))?;

    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    if state
        .db
        .has_running_run_for_repo(&repo.id)
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::conflict(
            "Another run is already active for this repository.",
        ));
    }

    // Create review comment
    let review_comment = state
        .db
        .add_review_comment(&task.id, &latest_run.id, comment)
        .map_err(ApiError::internal)?;
    state
        .db
        .update_review_comment_status(&review_comment.id, "processing", None)
        .map_err(ApiError::internal)?;

    // Resolve agent profile
    let profile = if let Some(profile_id) = payload.profile_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        state
            .db
            .get_agent_profile_by_id(profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Agent profile not found."))?
    } else {
        let preference = state
            .db
            .get_repo_agent_preference(&repo.id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Select an AI profile for this repo."))?;
        state
            .db
            .get_agent_profile_by_id(&preference.agent_profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Agent profile not found."))?
    };
    let agent_command = build_agent_command(&profile);

    // Create a new run linked to the review comment
    let run = state
        .db
        .create_run(
            &task.id,
            &latest_run.plan_id,
            "running",
            &latest_run.branch_name,
            Some(&profile.id),
            latest_run.worktree_path.as_deref(),
        )
        .map_err(ApiError::internal)?;
    state
        .db
        .update_run_review_comment_id(&run.id, &review_comment.id)
        .map_err(ApiError::internal)?;
    state
        .db
        .update_review_comment_status(&review_comment.id, "processing", Some(&run.id))
        .map_err(ApiError::internal)?;

    let response = json!({
        "reviewComment": review_comment,
        "run": { "id": run.id, "status": run.status }
    });

    // Spawn agent in background
    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let repo_path = repo.path.clone();
    let agent_working_dir = latest_run.worktree_path.clone().unwrap_or_else(|| repo.path.clone());
    let session_id = latest_run.agent_session_id.clone();
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;
    let comment_text = comment.to_string();

    tokio::spawn(async move {
        store
            .push(LogMsg::AgentText("Starting review feedback run...".to_string()))
            .await;

        // Build prompt with review comment
        let prompt = format!(
            "Review feedback on previous work:\n\n{}\n\nPlease address this feedback and make the necessary changes.",
            comment_text
        );

        // Build command — use --resume for Claude if session_id is available
        let agent_kind = if agent_command.to_lowercase().contains("claude") {
            "claude"
        } else {
            "other"
        };

        let spawn_result = if agent_kind == "claude" && session_id.is_some() {
            let sid = session_id.unwrap();
            // Build a custom command with --resume
            let parts: Vec<&str> = agent_command.split_whitespace().collect();
            let (bin, extra_args) = parts.split_first().unwrap();
            let mut cmd = tokio::process::Command::new(bin);
            cmd.args(extra_args.iter().copied());
            cmd.current_dir(&agent_working_dir);
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());
            cmd.stdin(std::process::Stdio::piped());
            cmd.env_remove("CLAUDECODE");
            cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
            cmd.arg("--resume").arg(&sid);
            cmd.arg("-p").arg(&prompt);
            cmd.arg("--permission-mode").arg("bypassPermissions");
            cmd.arg("--dangerously-skip-permissions");
            cmd.arg("--output-format").arg("stream-json");
            cmd.arg("--verbose");

            let child_result = cmd.group_spawn();
            match child_result {
                Ok(mut child) => {
                    // Close stdin
                    if let Some(mut stdin) = child.inner().stdin.take() {
                        tokio::spawn(async move {
                            let _ = stdin.shutdown().await;
                        });
                    }
                    // Spawn stdout reader
                    if let Some(stdout) = child.inner().stdout.take() {
                        let store_clone = store.clone();
                        tokio::spawn(async move {
                            let reader = tokio::io::BufReader::new(stdout);
                            let mut lines = reader.lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                if let Some((msg, sid)) = crate::executor::parse_claude_stream_json_pub(&line) {
                                    if let Some(s) = sid {
                                        store_clone.set_session_id(s).await;
                                    }
                                    store_clone.push(msg).await;
                                    continue;
                                }
                                store_clone.push_stdout(line).await;
                            }
                        });
                    }
                    // Spawn stderr reader
                    if let Some(stderr) = child.inner().stderr.take() {
                        let store_clone = store.clone();
                        tokio::spawn(async move {
                            let reader = tokio::io::BufReader::new(stderr);
                            let mut lines = reader.lines();
                            while let Ok(Some(line)) = lines.next_line().await {
                                store_clone.push_stderr(line).await;
                            }
                        });
                    }
                    Ok(child)
                }
                Err(e) => Err(anyhow::anyhow!("{}", e)),
            }
        } else {
            spawn_agent(&agent_command, &prompt, &agent_working_dir, store.clone()).await
        };

        match spawn_result {
            Ok(child) => {
                if let Some(pid) = child.id() {
                    let _ = db.update_run_pid(&run_id, pid as i64);
                }
                let _ = db.add_run_event(&run_id, "agent_spawned", &json!({ "command": agent_command, "isReviewRun": true }));
                pm.attach_child(&run_id, child).await;
                pm.spawn_exit_monitor(run_id, task_id, repo_path, agent_working_dir, db).await;
            }
            Err(e) => {
                store.push_stderr(format!("Failed to spawn agent: {}", e)).await;
                store.push_finished(None, "failed").await;
                let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
                let _ = db.update_run_status(&run_id, "failed", true);
            }
        }
    });

    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn list_reviews(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let comments = state
        .db
        .list_review_comments(&path.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "reviewComments": comments })))
}

async fn complete_task(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if task.status != "IN_REVIEW" {
        return Err(ApiError::bad_request("Task must be in IN_REVIEW status to complete."));
    }

    state
        .db
        .update_task_status(&path.task_id, "DONE")
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "status": "DONE", "taskId": path.task_id })))
}

async fn apply_to_main(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Response, ApiError> {
    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if task.status != "IN_REVIEW" && task.status != "DONE" {
        return Err(ApiError::bad_request(
            "Task must be in IN_REVIEW or DONE status to apply changes.",
        ));
    }

    // If worktree is off, changes are already on main — nothing to apply
    if !task.use_worktree {
        return Ok((
            StatusCode::OK,
            Json(json!({
                "applied": true,
                "filesChanged": 0,
                "baseBranch": "current",
                "directMode": true,
            })),
        )
            .into_response());
    }

    let run = state
        .db
        .get_latest_run_by_task(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("No run found for this task."))?;

    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    let base_branch =
        detect_base_branch(&repo.path).map_err(|e| ApiError::bad_request(&e.to_string()))?;

    let apply_result = if let Some(ref wt_path) = run.worktree_path {
        // Worktree mode: simplified merge (main repo is already on base branch)
        apply_worktree_to_base_unstaged(&repo.path, &run.branch_name, &base_branch, wt_path)
    } else {
        // Legacy fallback: old-style branch checkout merge
        apply_branch_to_base_unstaged(&repo.path, &run.branch_name, &base_branch)
    };

    match apply_result {
        Ok(result) => Ok((
            StatusCode::OK,
            Json(json!({
                "applied": true,
                "filesChanged": result.files_changed,
                "baseBranch": result.base_branch,
            })),
        )
            .into_response()),
        Err(ApplyError::Conflict(conflict)) => Ok((
            StatusCode::CONFLICT,
            Json(json!({
                "conflict": true,
                "conflictedFiles": conflict.conflicted_files,
            })),
        )
            .into_response()),
        Err(ApplyError::Internal(e)) => Err(ApiError::internal(e)),
    }
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

fn spawn_autostart_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            match state.db.claim_next_pending_autostart_job() {
                Ok(Some(job)) => {
                    let job_id = job.id.clone();
                    if let Err(error) = process_autostart_job(state.clone(), job).await {
                        let _ = state.db.fail_autostart_job(
                            &job_id,
                            &format!("worker internal error: {error}"),
                            None,
                            None,
                        );
                        eprintln!("autostart worker error: {error}");
                    }
                }
                Ok(None) => {
                    tokio::time::sleep(Duration::from_millis(700)).await;
                }
                Err(error) => {
                    eprintln!("autostart queue poll failed: {error}");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    });
}

async fn process_autostart_job(
    state: AppState,
    job: crate::models::AutostartJob,
) -> anyhow::Result<()> {
    let force_start = job.trigger_kind == "manual_requeue";
    let Some(task) = state.db.get_task_by_id(&job.task_id)? else {
        state
            .db
            .fail_autostart_job(&job.id, "task not found", None, None)?;
        return Ok(());
    };

    if !task.auto_start && !force_start {
        state.db.complete_autostart_job(&job.id, None, None)?;
        return Ok(());
    }
    if !is_todo_lane_status(&task.status) {
        state.db.complete_autostart_job(&job.id, None, None)?;
        return Ok(());
    }

    let Some(repo) = state.db.get_repo_by_id(&task.repo_id)? else {
        state
            .db
            .fail_autostart_job(&job.id, "repo not found", None, None)?;
        return Ok(());
    };

    if state.db.has_running_run_for_repo(&repo.id)? {
        state.db.requeue_autostart_job(
            &job.id,
            Some("repo has active running job, retrying"),
        )?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        return Ok(());
    }

    if !task.require_plan {
        match start_run(
            State(state.clone()),
            Json(StartRunPayload {
                plan_id: None,
                task_id: Some(task.id.clone()),
                profile_id: None,
            }),
        )
        .await
        {
            Ok((_, run_payload)) => {
                let run_id = run_payload
                    .0
                    .get("run")
                    .and_then(|r| r.get("id"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                state
                    .db
                    .complete_autostart_job(&job.id, None, run_id.as_deref())?;
            }
            Err(error) if error.status == StatusCode::CONFLICT => {
                state.db.requeue_autostart_job(&job.id, Some(&error.message))?;
            }
            Err(error) => {
                let msg = format!("autostart direct run failed: {}", error.message);
                let _ = state
                    .db
                    .update_task_pipeline_state(&task.id, Some(&msg));
                let _ = state.db.fail_autostart_job(&job.id, &msg, None, None);
            }
        }
        return Ok(());
    }

    if task.status.trim().eq_ignore_ascii_case("PLAN_APPROVED") {
        let approved_plan = state
            .db
            .list_plans_by_task(&task.id)?
            .into_iter()
            .find(|plan| plan.status == "approved");
        if let Some(plan) = approved_plan {
            match start_run(
                State(state.clone()),
                Json(StartRunPayload {
                    plan_id: Some(plan.id.clone()),
                    task_id: None,
                    profile_id: None,
                }),
            )
            .await
            {
                Ok((_, run_payload)) => {
                    let run_id = run_payload
                        .0
                        .get("run")
                        .and_then(|r| r.get("id"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string);
                    state
                        .db
                        .complete_autostart_job(&job.id, Some(&plan.id), run_id.as_deref())?;
                    return Ok(());
                }
                Err(error) if error.status == StatusCode::CONFLICT => {
                    state.db.requeue_autostart_job(&job.id, Some(&error.message))?;
                    return Ok(());
                }
                Err(error) => {
                    let msg = format!("autostart run failed: {}", error.message);
                    let _ = state
                        .db
                        .update_task_pipeline_state(&task.id, Some(&msg));
                    let _ = state
                        .db
                        .fail_autostart_job(&job.id, &msg, Some(&plan.id), None);
                    return Ok(());
                }
            }
        }
    }

    let Some(agent_command) = resolve_agent_command(&state, &repo.id) else {
        let msg = "auto-start failed: no AI profile selected for repo".to_string();
        let _ = state
            .db
            .update_task_pipeline_state(&task.id, Some(&msg));
        state.db.fail_autostart_job(&job.id, &msg, None, None)?;
        return Ok(());
    };

    let _ = state.db.update_task_status(&task.id, "PLAN_GENERATING");
    let _ = state.db.update_task_pipeline_state(&task.id, None);

    let plan_job = match state
        .db
        .create_plan_job(&task.id, "auto_pipeline", None)
    {
        Ok(job_row) => job_row,
        Err(error) => {
            let msg = format!("auto pipeline could not create plan job: {error}");
            let _ = state
                .db
                .update_task_pipeline_state(&task.id, Some(&msg));
            state.db.fail_autostart_job(&job.id, &msg, None, None)?;
            return Ok(());
        }
    };

    let store_key = plan_store_key(&plan_job.id);
    let has_store = state.process_manager.get_store(&store_key).await.is_some();
    if !has_store && plan_job.status == "running" {
        let _ = state.db.fail_plan_job(
            &plan_job.id,
            "Recovered stale running auto pipeline plan job (missing live process store).",
            plan_job.plan_id.as_deref(),
        );
        // Reset task from PLAN_GENERATING so it can be retried
        let _ = state.db.update_task_status(&task.id, "To Do");
    }

    let refreshed_plan_job = state
        .db
        .get_plan_job_by_id(&plan_job.id)?
        .unwrap_or(plan_job.clone());

    match refreshed_plan_job.status.as_str() {
        "pending" if !state.process_manager.get_store(&plan_store_key(&refreshed_plan_job.id)).await.is_some() => {
            let store = MsgStore::new();
            state
                .process_manager
                .register_store(&plan_store_key(&refreshed_plan_job.id), store.clone())
                .await;
            spawn_plan_generation_job(
                state.clone(),
                refreshed_plan_job.clone(),
                task.clone(),
                repo.path.clone(),
                agent_command,
                "auto_pipeline",
                store,
                Some(job.id.clone()),
            );
            // Autostart job stays `running` — the background task will complete/fail it.
        }
        "running" if has_store => {
            // Plan generation is actively running with a live store.
            // The background task will handle autostart completion.
            // Requeue ourselves so the worker checks back later.
            state.db.requeue_autostart_job(
                &job.id,
                Some("plan generation still running, will retry"),
            )?;
        }
        "done" | "failed" => {
            // Plan job already finished — if it failed, the stale recovery above
            // already reset the task. Just complete the autostart job.
            state
                .db
                .complete_autostart_job(&job.id, refreshed_plan_job.plan_id.as_deref(), None)?;
        }
        _ => {
            // Plan job is in an unexpected state (e.g., "pending" with an active store,
            // or "running" without store after recovery above). Requeue to retry.
            state.db.requeue_autostart_job(
                &job.id,
                Some(&format!("plan job in unexpected state '{}', retrying", refreshed_plan_job.status)),
            )?;
        }
    }
    Ok(())
}

fn enqueue_autostart_if_enabled(
    state: &AppState,
    task: &TaskWithPayload,
    trigger_kind: &str,
) -> Result<(), ApiError> {
    if !task.auto_start {
        return Ok(());
    }
    if !is_todo_lane_status(&task.status) {
        return Ok(());
    }
    state
        .db
        .enqueue_autostart_job(&task.id, trigger_kind)
        .map_err(ApiError::internal)?;
    Ok(())
}

fn is_todo_lane_status(status: &str) -> bool {
    let upper = status.trim().to_uppercase();
    matches!(
        upper.as_str(),
        "TO DO"
            | "TODO"
            | "PLAN_GENERATING"
            | "PLAN_DRAFTED"
            | "PLAN_APPROVED"
            | "PLAN_REVISE_REQUESTED"
            | "FAILED"
            | "CANCELLED"
    ) || status.to_lowercase().contains("to do")
}

fn sanitize_branch_segment(input: &str) -> String {
    input
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '/' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(45)
        .collect()
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

    if !base.is_dir() {
        return Err(ApiError::bad_request("Path is not a directory."));
    }

    let canonical = base
        .canonicalize()
        .map_err(|_| ApiError::bad_request("Cannot resolve path."))?;

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

fn home_dir() -> std::path::PathBuf {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/"))
}

/// Look up the agent command for a repo's preferred agent profile.
fn resolve_agent_command(state: &AppState, repo_id: &str) -> Option<String> {
    let pref = state.db.get_repo_agent_preference(repo_id).ok()??;
    let profile = state.db.get_agent_profile_by_id(&pref.agent_profile_id).ok()??;
    Some(build_agent_command(&profile))
}

fn build_agent_command(profile: &crate::models::AgentProfile) -> String {
    let command = profile.command.trim();
    if command.is_empty() {
        return profile.command.clone();
    }

    let provider = profile.provider.to_lowercase();
    let model = profile.model.trim();
    if model.is_empty() || model.eq_ignore_ascii_case("default") {
        return command.to_string();
    }

    if provider.contains("codex") {
        return format!("{command} -m {model}");
    }
    if provider.contains("claude") || provider.contains("gemini") || provider.contains("cursor") {
        return format!("{command} --model {model}");
    }

    command.to_string()
}




// ── Generic Provider Handlers ──

async fn list_providers(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let metas = state.registry.all_metas();
    Ok(Json(json!({ "providers": metas })))
}

#[derive(Debug, Deserialize)]
struct ProviderPath {
    provider_id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderAccountPath {
    provider_id: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderItemPath {
    provider_id: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderRepoPath {
    provider_id: String,
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderItemQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderBindPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "resourceId")]
    resource_id: String,
    config: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ProviderItemActionPayload {
    action: String,
}

async fn provider_connect(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let result = provider
        .validate_credentials(&payload)
        .await
        .map_err(ApiError::bad_request_from)?;

    let account = state
        .db
        .upsert_provider_account(&path.provider_id, &payload, &result.display_name)
        .map_err(ApiError::internal)?;

    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let masked_config = provider.mask_account(config);

    Ok(Json(json!({
        "account": {
            "id": account.id,
            "providerId": account.provider_id,
            "displayName": account.display_name,
            "config": masked_config,
        },
        "extra": result.extra,
    })))
}

async fn provider_list_accounts(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let accounts = state
        .db
        .list_provider_accounts(&path.provider_id)
        .map_err(ApiError::internal)?;

    let masked: Vec<Value> = accounts
        .into_iter()
        .map(|a| {
            let config: Value = serde_json::from_str(&a.config_json).unwrap_or(Value::Null);
            let masked_config = provider.mask_account(config);
            json!({
                "id": a.id,
                "providerId": a.provider_id,
                "displayName": a.display_name,
                "config": masked_config,
                "createdAt": a.created_at,
                "updatedAt": a.updated_at,
            })
        })
        .collect();

    Ok(Json(json!({ "accounts": masked })))
}

async fn provider_delete_account(
    State(state): State<AppState>,
    Path(path): Path<ProviderAccountPath>,
) -> Result<Json<Value>, ApiError> {
    let _provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    state
        .db
        .delete_provider_account(&path.id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": true })))
}

async fn provider_list_resources(
    State(state): State<AppState>,
    Path(path): Path<ProviderAccountPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let account = state
        .db
        .get_provider_account(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Account not found."))?;

    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let resources = provider
        .list_resources(&config)
        .await
        .map_err(ApiError::bad_request_from)?;

    // Upsert into local DB
    let tuples: Vec<(String, String, String)> = resources
        .iter()
        .map(|r| (r.external_id.clone(), r.name.clone(), r.extra.to_string()))
        .collect();
    state
        .db
        .upsert_provider_resources(&account.id, &path.provider_id, &tuples)
        .map_err(ApiError::internal)?;

    let local_resources = state
        .db
        .list_provider_resources(&account.id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "resources": local_resources })))
}

async fn provider_bind(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Json(payload): Json<ProviderBindPayload>,
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
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Account not found."));
    }
    if state
        .db
        .get_provider_resource(&payload.resource_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Resource not found."));
    }

    let config_json = payload
        .config
        .as_ref()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "{}".to_string());

    let binding = state
        .db
        .create_provider_binding(
            &payload.repo_id,
            &payload.account_id,
            &payload.resource_id,
            &path.provider_id,
            &config_json,
        )
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "binding": binding })))
}

async fn provider_list_bindings(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Query(query): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let all = state
        .db
        .list_provider_bindings_for_repo(&query.repo_id)
        .map_err(ApiError::internal)?;
    let filtered: Vec<_> = all
        .into_iter()
        .filter(|b| b.provider_id == path.provider_id)
        .collect();
    Ok(Json(json!({ "bindings": filtered })))
}

async fn provider_list_items(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
    Query(query): Query<ProviderItemQuery>,
) -> Result<Json<Value>, ApiError> {
    let items = state
        .db
        .list_provider_items(&path.repo_id, &path.provider_id, query.status.as_deref())
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "items": items })))
}

async fn provider_item_action(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
    Json(payload): Json<ProviderItemActionPayload>,
) -> Result<Json<Value>, ApiError> {
    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    match payload.action.as_str() {
        "ignore" => {
            state
                .db
                .update_provider_item_status(&item.id, "ignored")
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "ignored" })))
        }
        "restore" => {
            state
                .db
                .update_provider_item_status(&item.id, "pending")
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "pending" })))
        }
        _ => Err(ApiError::bad_request("Unsupported action. Use 'ignore' or 'restore'.")),
    }
}

async fn provider_clear_items(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
) -> Result<Json<Value>, ApiError> {
    let deleted = state
        .db
        .delete_provider_items_for_repo(&path.provider_id, &path.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn provider_item_event(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
) -> Result<Json<Value>, ApiError> {
    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    // Find the account that owns this item so we can read credentials
    let account = state
        .db
        .get_provider_account(&item.provider_account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found."))?;

    let config: serde_json::Value =
        serde_json::from_str(&account.config_json).unwrap_or_default();
    let base_url = config["base_url"].as_str().unwrap_or_default();
    let org_slug = config["org_slug"].as_str().unwrap_or_default();
    let auth_token = config["auth_token"].as_str().unwrap_or_default();

    let client = provider::sentry::client::SentryClient::new(base_url, org_slug, auth_token);
    let event = client
        .fetch_latest_event(&item.external_id)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "event": event })))
}

async fn provider_create_task_from_item(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    if item.linked_task_id.is_some() && item.status != "regression" {
        return Err(ApiError::bad_request("This item already has a linked task."));
    }

    // Find the repo via binding
    let bindings = state
        .db
        .list_provider_bindings(&path.provider_id)
        .map_err(ApiError::internal)?;
    let binding = bindings
        .iter()
        .find(|b| {
            b.provider_account_id == item.provider_account_id
                && b.provider_resource_id == item.provider_resource_id
        })
        .ok_or_else(|| ApiError::bad_request("No repo binding found for this item."))?;

    let data: Value = serde_json::from_str(&item.data_json).unwrap_or(Value::Null);
    let provider_item = crate::provider::ProviderItem {
        external_id: item.external_id.clone(),
        title: item.title.clone(),
        data: data.clone(),
    };

    let fields = provider.item_to_task_fields(&provider_item);

    let task_payload = CreateTaskPayload {
        repo_id: binding.repo_id.clone(),
        title: fields.title,
        description: fields.description,
        status: Some("To Do".to_string()),
        priority: Some("High".to_string()),
        require_plan: Some(fields.require_plan),
        auto_start: Some(fields.auto_start),
        auto_approve_plan: Some(false),
        use_worktree: Some(true),
    };

    let task = state
        .db
        .create_manual_task(&task_payload)
        .map_err(ApiError::internal)?;

    state
        .db
        .link_provider_item_to_task(&item.id, &task.id)
        .map_err(ApiError::internal)?;

    // Auto-trigger plan generation if agent is configured
    if let Some(agent_command) = resolve_agent_command(&state, &binding.repo_id) {
        if let Ok(Some(repo)) = state.db.get_repo_by_id(&binding.repo_id) {
            let mode = format!("auto_{}", path.provider_id);
            if let Ok(job) = state.db.create_plan_job(&task.id, &mode, None) {
                let store = MsgStore::new();
                state
                    .process_manager
                    .register_store(&plan_store_key(&job.id), store.clone())
                    .await;
                spawn_plan_generation_job(
                    state.clone(),
                    job,
                    task.clone(),
                    repo.path.clone(),
                    agent_command,
                    &mode,
                    store,
                    None,
                );
            }
        }
    }

    Ok(Json(json!({ "task": task, "itemId": item.id })))
}

async fn provider_manual_sync(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    if !provider.meta().has_items_panel {
        return Err(ApiError::bad_request("This provider does not support item sync."));
    }

    let bindings = state
        .db
        .list_provider_bindings_for_repo(&path.repo_id)
        .map_err(ApiError::internal)?;
    let bindings: Vec<_> = bindings
        .into_iter()
        .filter(|b| b.provider_id == path.provider_id)
        .collect();
    if bindings.is_empty() {
        return Err(ApiError::bad_request("No bindings for this provider and repo."));
    }

    let mut total_synced = 0usize;
    let mut sync_errors = Vec::new();
    for binding in &bindings {
        let account = match state.db.get_provider_account(&binding.provider_account_id) {
            Ok(Some(a)) => a,
            Ok(None) => {
                sync_errors.push(format!("Account {} not found", binding.provider_account_id));
                continue;
            }
            Err(e) => {
                sync_errors.push(format!("Account load error: {e}"));
                continue;
            }
        };
        let resource = match state.db.get_provider_resource(&binding.provider_resource_id) {
            Ok(Some(r)) => r,
            Ok(None) => {
                sync_errors.push(format!("Resource {} not found", binding.provider_resource_id));
                continue;
            }
            Err(e) => {
                sync_errors.push(format!("Resource load error: {e}"));
                continue;
            }
        };

        let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
        let since = state
            .db
            .get_last_provider_sync_time(&account.id, &resource.id)
            .unwrap_or(None);

        let items = match provider
            .sync_items(&config, &resource.external_id, since.as_deref())
            .await
        {
            Ok(items) => items,
            Err(e) => {
                sync_errors.push(format!("Sync {} failed: {e}", resource.external_id));
                continue;
            }
        };

        if !items.is_empty() {
            let tuples: Vec<(String, String, String)> = items
                .iter()
                .map(|i| (i.external_id.clone(), i.title.clone(), i.data.to_string()))
                .collect();
            match state.db.upsert_provider_items(
                &account.id,
                &resource.id,
                &path.provider_id,
                &tuples,
            ) {
                Ok(count) => total_synced += count,
                Err(e) => sync_errors.push(format!("DB upsert error: {e}")),
            }
        }
    }

    let items = state
        .db
        .list_provider_items(&path.repo_id, &path.provider_id, None)
        .map_err(ApiError::internal)?;
    let mut resp = json!({ "synced": total_synced, "items": items });
    if !sync_errors.is_empty() {
        resp["errors"] = json!(sync_errors);
    }
    Ok(Json(resp))
}

// ── Generic Provider Sync Worker ──

fn spawn_provider_sync_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await; // 5 minutes

            for provider in state.registry.all() {
                if !provider.meta().has_items_panel {
                    continue;
                }

                let bindings = match state.db.list_provider_bindings(provider.meta().id) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!(
                            "Provider sync worker: failed to list bindings for {}: {e}",
                            provider.meta().id
                        );
                        continue;
                    }
                };

                for binding in &bindings {
                    let account = match state.db.get_provider_account(&binding.provider_account_id) {
                        Ok(Some(a)) => a,
                        _ => continue,
                    };
                    let resource =
                        match state.db.get_provider_resource(&binding.provider_resource_id) {
                            Ok(Some(r)) => r,
                            _ => continue,
                        };

                    let config: Value =
                        serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
                    let since = state
                        .db
                        .get_last_provider_sync_time(&account.id, &resource.id)
                        .unwrap_or(None);

                    let items = match provider
                        .sync_items(&config, &resource.external_id, since.as_deref())
                        .await
                    {
                        Ok(items) => items,
                        Err(e) => {
                            eprintln!(
                                "Provider sync worker: fetch error for {} / {}: {e}",
                                provider.meta().id,
                                resource.external_id
                            );
                            continue;
                        }
                    };

                    if !items.is_empty() {
                        let tuples: Vec<(String, String, String)> = items
                            .iter()
                            .map(|i| {
                                (i.external_id.clone(), i.title.clone(), i.data.to_string())
                            })
                            .collect();
                        if let Err(e) = state.db.upsert_provider_items(
                            &account.id,
                            &resource.id,
                            provider.meta().id,
                            &tuples,
                        ) {
                            eprintln!(
                                "Provider sync worker: upsert error for {} / {}: {e}",
                                provider.meta().id,
                                resource.external_id
                            );
                        }
                    }
                }
            }
        }
    });
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn bad_request_from(error: anyhow::Error) -> Self {
        Self::bad_request(error.to_string())
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn internal(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

#[derive(Debug, Deserialize)]
struct CreateRepoPayload {
    path: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RepoQuery {
    #[serde(rename = "repoId")]
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct SyncTasksPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct CreatePlanPayload {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "revisionComment")]
    revision_comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskQuery {
    #[serde(rename = "taskId")]
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct PlanPath {
    #[serde(rename = "plan_id")]
    plan_id: String,
}

#[derive(Debug, Deserialize)]
struct PlanJobPath {
    #[serde(rename = "job_id")]
    job_id: String,
}

#[derive(Debug, Deserialize)]
struct PlanActionPayload {
    action: String,
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManualPlanRevisionPayload {
    #[serde(rename = "planMarkdown")]
    plan_markdown: String,
    #[serde(rename = "planJson")]
    plan_json: Value,
    #[serde(rename = "tasklistJson")]
    tasklist_json: Value,
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StartRunPayload {
    #[serde(rename = "planId")]
    plan_id: Option<String>,
    #[serde(rename = "taskId")]
    task_id: Option<String>,
    #[serde(rename = "profileId")]
    profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RunPath {
    #[serde(rename = "run_id")]
    run_id: String,
}

#[derive(Debug, Deserialize)]
struct FsListQuery {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SelectAgentPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "profileId")]
    profile_id: String,
}

#[derive(Debug, Deserialize)]
struct TaskPath {
    #[serde(rename = "task_id")]
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskStatusPayload {
    status: String,
}

#[derive(Debug, Deserialize)]
struct SubmitReviewPayload {
    comment: String,
    #[serde(rename = "profileId")]
    profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskPayload {
    title: Option<String>,
    description: Option<Option<String>>,
    priority: Option<Option<String>>,
    #[serde(rename = "requirePlan")]
    require_plan: Option<bool>,
    #[serde(rename = "autoStart")]
    auto_start: Option<bool>,
    #[serde(rename = "autoApprovePlan")]
    auto_approve_plan: Option<bool>,
    #[serde(rename = "useWorktree")]
    use_worktree: Option<bool>,
}

