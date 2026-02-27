mod db;
mod discovery;
mod executor;
mod jira;
mod models;
mod msg_store;
mod planner;
mod process_manager;

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
    executor::{create_execution_branch, save_plan_artifact, spawn_agent},
    jira::JiraClient,
    models::{CreateTaskPayload, PlanJob, TaskWithPayload},
    msg_store::{LogMsg, MsgStore},
    planner::{
        generate_plan_and_tasklist_with_agent_strict, validate_plan_payload,
        validate_tasklist_payload,
    },
    process_manager::ProcessManager,
};

#[derive(Clone)]
struct AppState {
    db: Arc<Db>,
    process_manager: Arc<ProcessManager>,
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
    let state = AppState { db, process_manager };
    spawn_autostart_worker(state.clone());

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/repos", get(list_repos).post(create_repo))
        .route("/api/jira/connect", post(connect_jira))
        .route("/api/jira/accounts", get(list_jira_accounts))
        .route("/api/jira/boards", get(fetch_jira_boards))
        .route("/api/jira/bind", post(bind_repo_to_board))
        .route("/api/jira/binding", get(get_repo_binding))
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
        .route("/api/agents/discover", get(discover_agents))
        .route("/api/agents", get(list_agents))
        .route("/api/agents/select", post(select_repo_agent))
        .route("/api/agents/selection", get(get_repo_agent_selection))
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
    let jira_accounts = state
        .db
        .list_jira_accounts()
        .map_err(ApiError::internal)?
        .into_iter()
        .map(masked_account)
        .collect::<Vec<_>>();
    let agent_profiles = state.db.list_agent_profiles().map_err(ApiError::internal)?;
    Ok(Json(json!({
      "repos": repos,
      "jiraAccounts": jira_accounts,
      "agentProfiles": agent_profiles
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

async fn connect_jira(
    State(state): State<AppState>,
    Json(payload): Json<ConnectJiraPayload>,
) -> Result<Json<Value>, ApiError> {
    if !payload.base_url.starts_with("http://") && !payload.base_url.starts_with("https://") {
        return Err(ApiError::bad_request("Jira baseUrl must start with http:// or https://"));
    }
    if payload.api_token.trim().len() < 3 {
        return Err(ApiError::bad_request("Jira token is too short."));
    }

    let client = JiraClient::new(&payload.base_url, &payload.email, &payload.api_token);
    let me = client
        .validate_credentials()
        .await
        .map_err(ApiError::bad_request_from)?;
    let account = state
        .db
        .create_or_update_jira_account(&payload.base_url, &payload.email, &payload.api_token)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({
      "account": masked_account(account),
      "me": {
        "accountId": me.account_id,
        "displayName": me.display_name,
        "emailAddress": me.email_address
      },
      "warning": "Token is stored locally in plaintext for this MVP build."
    })))
}

async fn list_jira_accounts(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let accounts = state
        .db
        .list_jira_accounts()
        .map_err(ApiError::internal)?
        .into_iter()
        .map(masked_account)
        .collect::<Vec<_>>();
    Ok(Json(json!({ "accounts": accounts })))
}

async fn fetch_jira_boards(
    State(state): State<AppState>,
    Query(query): Query<AccountQuery>,
) -> Result<Json<Value>, ApiError> {
    let account = state
        .db
        .get_jira_account_by_id(&query.account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Jira account not found."))?;
    let client = JiraClient::new(&account.base_url, &account.email, &account.api_token);
    let boards = client.fetch_boards().await.map_err(ApiError::bad_request_from)?;
    state
        .db
        .upsert_jira_boards(&account.id, &boards)
        .map_err(ApiError::internal)?;
    let local_boards = state
        .db
        .list_boards_by_account(&account.id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "boards": local_boards })))
}

async fn bind_repo_to_board(
    State(state): State<AppState>,
    Json(payload): Json<BindBoardPayload>,
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
        .get_jira_account_by_id(&payload.account_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Jira account not found."));
    }
    if state
        .db
        .get_board_by_id(&payload.board_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Board not found."));
    }

    let binding = state
        .db
        .upsert_repo_binding(&payload.repo_id, &payload.account_id, &payload.board_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "binding": binding })))
}

async fn get_repo_binding(
    State(state): State<AppState>,
    Query(query): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let binding = state
        .db
        .get_repo_binding(&query.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "binding": binding })))
}

async fn sync_tasks(
    State(state): State<AppState>,
    Json(payload): Json<SyncTasksPayload>,
) -> Result<Json<Value>, ApiError> {
    let binding = state
        .db
        .get_repo_binding(&payload.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Repo is not bound to a Jira board."))?;
    let account = state
        .db
        .get_jira_account_by_id(&binding.jira_account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Invalid binding account."))?;
    let board = state
        .db
        .get_board_by_id(&binding.jira_board_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Invalid binding board."))?;

    let client = JiraClient::new(&account.base_url, &account.email, &account.api_token);
    let had_jira_tasks_before = state
        .db
        .list_tasks_by_repo(&payload.repo_id)
        .map_err(ApiError::internal)?
        .iter()
        .any(|task| task.source == "jira");
    let issues = client
        .fetch_assigned_board_issues(&board.board_id, None)
        .await
        .map_err(ApiError::bad_request_from)?;
    let sync_result = state
        .db
        .upsert_tasks(&payload.repo_id, &account.id, &board.id, &issues)
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
    generation_mode: &'static str,
    store: Arc<MsgStore>,
    autostart_job_id: Option<String>,
) {
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
            generation_mode,
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
    let branch_name = format!(
        "codex/{}-{}-{}",
        if agent_segment.is_empty() {
            "agent".to_string()
        } else {
            agent_segment
        },
        if task_segment.is_empty() {
            "task".to_string()
        } else {
            task_segment
        },
        chrono::Utc::now().timestamp()
    );

    let run = state
        .db
        .create_run(
            &task.id,
            &plan_id,
            "running",
            &branch_name,
            Some(&profile.id),
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
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;

    tokio::spawn(async move {
        store
            .push(LogMsg::AgentText(
                "Preparing execution branch and plan artifact...".to_string(),
            ))
            .await;

        // Step 1: Create branch + save artifact (blocking git ops)
        let branch_result = {
            let rp = repo_path.clone();
            let bn = branch_name.clone();
            tokio::task::spawn_blocking(move || create_execution_branch(&rp, &bn)).await
        };

        if let Err(e) = branch_result
            .as_ref()
            .map_err(|e| anyhow::anyhow!("{}", e))
            .and_then(|r| r.as_ref().map_err(|e| anyhow::anyhow!("{}", e)))
        {
            store
                .push_stderr(format!("Run failed while creating branch: {}", e))
                .await;
            store.push_finished(None, "failed").await;
            let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
            let _ = db.update_run_status(&run_id, "failed", true);
            let _ = db.update_task_status(&task_id, "FAILED");
            return;
        }

        store
            .push(LogMsg::AgentText("Execution branch ready.".to_string()))
            .await;

        let artifact_result = {
            let rp = repo_path.clone();
            let ik = issue_key.clone();
            let pm_text = plan_markdown.clone();
            let pv = plan_version;
            tokio::task::spawn_blocking(move || save_plan_artifact(&rp, &ik, pv, &pm_text)).await
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

        // Step 3: Spawn agent
        store
            .push(LogMsg::AgentText("Starting agent process...".to_string()))
            .await;
        match spawn_agent(&agent_command, &prompt, &repo_path, store.clone()).await {
            Ok(child) => {
                // Record PID
                if let Some(pid) = child.id() {
                    let _ = db.update_run_pid(&run_id, pid as i64);
                }
                let _ = db.add_run_event(&run_id, "agent_spawned", &json!({ "command": agent_command }));

                pm.attach_child(&run_id, child).await;
                pm.spawn_exit_monitor(run_id, task_id, repo_path, db).await;
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

fn masked_account(account: crate::models::JiraAccount) -> Value {
    json!({
      "id": account.id,
      "base_url": account.base_url,
      "email": account.email,
      "api_token": "********",
      "created_at": account.created_at,
      "updated_at": account.updated_at
    })
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
struct ConnectJiraPayload {
    #[serde(rename = "baseUrl")]
    base_url: String,
    email: String,
    #[serde(rename = "apiToken")]
    api_token: String,
}

#[derive(Debug, Deserialize)]
struct AccountQuery {
    #[serde(rename = "accountId")]
    account_id: String,
}

#[derive(Debug, Deserialize)]
struct RepoQuery {
    #[serde(rename = "repoId")]
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct BindBoardPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "boardId")]
    board_id: String,
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
}
