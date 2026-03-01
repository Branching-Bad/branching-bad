use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::StatusCode,
    response::Response,
    routing::{get, post},
};
use command_group::AsyncCommandGroup;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncWriteExt;

use crate::AppState;
use crate::db::Db;
use crate::errors::ApiError;
use crate::executor::{create_worktree, git_status_info, save_plan_artifact, spawn_agent};
use crate::msg_store::{LogMsg, MsgStore};
use crate::process_manager::ProcessManager;
use super::shared::{StartRunPayload, TaskQuery, build_agent_command, sanitize_branch_segment};

pub(crate) fn run_routes() -> Router<AppState> {
    Router::new()
        .route("/api/runs/start", post(start_run))
        .route("/api/runs/latest", get(get_latest_run_for_task))
        .route("/api/runs/{run_id}", get(get_run))
        .route("/api/runs/{run_id}/ws", get(run_ws_handler))
        .route("/api/runs/{run_id}/stop", post(stop_run))
        .route("/api/runs/{run_id}/diff", get(get_run_diff))
        .route("/api/runs/{run_id}/git-status", get(get_run_git_status))
}

#[derive(Debug, Deserialize)]
struct RunPath {
    #[serde(rename = "run_id")]
    run_id: String,
}

pub(crate) async fn start_run(
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
            let task_id = provided_task_id.ok_or_else(|| {
                ApiError::bad_request("Provide planId or taskId to start a run.")
            })?;
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
    } else if let Some(ref task_profile_id) = task.agent_profile_id {
        state
            .db
            .get_agent_profile_by_id(task_profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Task-level agent profile no longer exists."))?
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

    let branch_name = if task.use_worktree {
        // Use custom branch name if provided, otherwise auto-generate
        if let Some(custom) = payload.branch_name.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            sanitize_branch_segment(custom)
        } else {
            let agent_segment = sanitize_branch_segment(&profile.provider);
            let task_segment = sanitize_branch_segment(&task.jira_issue_key);
            format!(
                "agent/{}-{}-{}",
                if agent_segment.is_empty() { "agent".to_string() } else { agent_segment },
                if task_segment.is_empty() { "task".to_string() } else { task_segment },
                chrono::Utc::now().timestamp()
            )
        }
    } else {
        String::new()
    };

    let run = state
        .db
        .create_run(
            &task.id,
            &plan_id,
            "running",
            &branch_name,
            Some(&profile.id),
            None,
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
        let agent_working_dir: String;

        if use_worktree {
            store
                .push(LogMsg::AgentText(
                    "Creating worktree for isolated execution...".to_string(),
                ))
                .await;

            let wt_result = {
                let rp = repo_path.clone();
                let bn = branch_name.clone();
                tokio::task::spawn_blocking(move || create_worktree(&rp, &bn)).await
            };

            match wt_result {
                Ok(Ok(wt_info)) => {
                    agent_working_dir = wt_info.worktree_path.clone();
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
                    let _ = db.add_run_event(
                        &run_id,
                        "run_failed",
                        &json!({ "error": e.to_string() }),
                    );
                    let _ = db.update_run_status(&run_id, "failed", true);
                    let _ = db.update_task_status(&task_id, "FAILED");
                    return;
                }
                Err(e) => {
                    store
                        .push_stderr(format!("Run failed while creating worktree: {}", e))
                        .await;
                    store.push_finished(None, "failed").await;
                    let _ = db.add_run_event(
                        &run_id,
                        "run_failed",
                        &json!({ "error": e.to_string() }),
                    );
                    let _ = db.update_run_status(&run_id, "failed", true);
                    let _ = db.update_task_status(&task_id, "FAILED");
                    return;
                }
            }
        } else {
            store
                .push(LogMsg::AgentText(
                    "Direct mode: agent will work on current branch.".to_string(),
                ))
                .await;
            agent_working_dir = repo_path.clone();
        }

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
                let _ = db.add_run_event(
                    &run_id,
                    "plan_artifact_saved",
                    &json!({ "artifactPath": artifact_path }),
                );
            }
            _ => {
                store
                    .push_stderr(
                        "Run failed: could not save execution plan artifact.".to_string(),
                    )
                    .await;
                store.push_finished(None, "failed").await;
                let _ = db.add_run_event(
                    &run_id,
                    "run_failed",
                    &json!({ "error": "failed to save plan artifact" }),
                );
                let _ = db.update_run_status(&run_id, "failed", true);
                let _ = db.update_task_status(&task_id, "FAILED");
                return;
            }
        }

        let tasklist_pretty = serde_json::to_string_pretty(&plan_tasklist_json)
            .unwrap_or_else(|_| "{}".to_string());
        let prompt = format!(
            "You are working on issue {}.\n\nTask: {}\n\nDescription: {}\n\nExecution Plan:\n{}\n\nTasklist JSON:\n{}\n\nExecution constraints:\n- Follow phase order and respect blocked_by dependencies between tasks.\n- Report progress using task IDs from tasklist.\n- Each task has a `complexity` (low/medium/high) and `suggested_model` field. When delegating subtasks to subagents, use the suggested model tier or an equivalent capability level available to you. Low complexity tasks should use the fastest/cheapest model, high complexity tasks should use the most capable model.\n- If useful, use subagents/tools for parallelizable subtasks while preserving dependencies.",
            issue_key,
            task.title,
            task.description.as_deref().unwrap_or("No description"),
            plan_markdown,
            tasklist_pretty
        );

        store
            .push(LogMsg::AgentText("Starting agent process...".to_string()))
            .await;
        match spawn_agent(&agent_command, &prompt, &agent_working_dir, store.clone()).await {
            Ok(child) => {
                if let Some(pid) = child.id() {
                    let _ = db.update_run_pid(&run_id, pid as i64);
                }
                let _ = db.add_run_event(
                    &run_id,
                    "agent_spawned",
                    &json!({
                        "command": agent_command,
                        "useWorktree": use_worktree,
                        "workingDir": &agent_working_dir
                    }),
                );

                pm.attach_child(&run_id, child).await;
                pm.spawn_exit_monitor(run_id, task_id, repo_path, agent_working_dir, db)
                    .await;
            }
            Err(e) => {
                store
                    .push_stderr(format!("Failed to spawn agent: {}", e))
                    .await;
                store.push_finished(None, "failed").await;
                let _ = db.add_run_event(
                    &run_id,
                    "run_failed",
                    &json!({ "error": e.to_string() }),
                );
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

async fn run_ws_handler(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let run = state
        .db
        .get_run_by_id(&path.run_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Run not found."))?;

    if let Some(store) = state.process_manager.get_store(&path.run_id).await {
        return Ok(ws.on_upgrade(move |socket| ws_send_stream(socket, store)));
    }

    if run.status == "running" {
        let store_key = path.run_id.clone();
        let pm = state.process_manager.clone();
        return Ok(ws.on_upgrade(move |socket| {
            ws_wait_for_store(socket, pm, store_key, false)
        }));
    }

    let events = state
        .db
        .list_run_events(&path.run_id)
        .map_err(ApiError::internal)?;

    let mut messages: Vec<String> = events
        .iter()
        .map(|e| {
            json!({ "type": "db_event", "data": json!({ "type": e.r#type, "payload": e.payload }).to_string() }).to_string()
        })
        .collect();

    messages.push(
        json!({ "type": "finished", "data": json!({ "exitCode": run.exit_code, "status": run.status }).to_string() }).to_string(),
    );

    Ok(ws.on_upgrade(move |socket| ws_send_batch(socket, messages)))
}

pub(crate) async fn plan_job_ws_handler(
    State(state): State<AppState>,
    Path(path): Path<super::plans::PlanJobPath>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let job = state
        .db
        .get_plan_job_by_id(&path.job_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan job not found."))?;

    let plan_store_key = super::shared::plan_store_key(&path.job_id);

    if let Some(store) = state.process_manager.get_store(&plan_store_key).await {
        return Ok(ws.on_upgrade(move |socket| ws_send_stream(socket, store)));
    }

    if job.status == "running" || job.status == "pending" {
        let pm = state.process_manager.clone();
        return Ok(ws.on_upgrade(move |socket| {
            ws_wait_for_store(socket, pm, plan_store_key, true)
        }));
    }

    let mut messages: Vec<String> = vec![
        json!({ "type": "db_event", "data": json!({ "type": "status", "payload": { "message": format!("Plan job status: {}", job.status) } }).to_string() }).to_string()
    ];

    if let Some(error) = job.error.as_deref() {
        messages.push(json!({ "type": "stderr", "data": error }).to_string());
    }

    messages.push(
        json!({ "type": "finished", "data": json!({ "exitCode": if job.status == "done" { Some(0) } else { None::<i32> }, "status": job.status }).to_string() }).to_string(),
    );

    Ok(ws.on_upgrade(move |socket| ws_send_batch(socket, messages)))
}

async fn ws_send_stream(mut socket: WebSocket, store: Arc<MsgStore>) {
    let mut stream = std::pin::pin!(store.ws_stream().await);
    while let Some(json_str) = stream.next().await {
        let is_finished = json_str.contains("\"type\":\"finished\"");
        if socket.send(Message::Text(json_str.into())).await.is_err() {
            break;
        }
        if is_finished {
            break;
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

async fn ws_send_batch(mut socket: WebSocket, messages: Vec<String>) {
    for msg in messages {
        if socket.send(Message::Text(msg.into())).await.is_err() {
            break;
        }
    }
    let _ = socket.send(Message::Close(None)).await;
}

async fn ws_wait_for_store(
    mut socket: WebSocket,
    pm: Arc<ProcessManager>,
    store_key: String,
    is_plan: bool,
) {
    let status_msg = if is_plan {
        "Waiting for plan output..."
    } else {
        "Run is starting. Waiting for agent stream..."
    };
    let _ = socket
        .send(Message::Text(
            json!({ "type": "db_event", "data": json!({ "type": "status", "payload": { "message": status_msg } }).to_string() })
                .to_string()
                .into(),
        ))
        .await;

    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(store) = pm.get_store(&store_key).await {
            ws_send_stream(socket, store).await;
            return;
        }
    }
    let _ = socket.send(Message::Close(None)).await;
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
        return Err(ApiError::bad_request(
            "No running process found for this run.",
        ));
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

    if let Some(store) = state.process_manager.get_store(&path.run_id).await {
        store.push_finished(None, "cancelled").await;
    }

    Ok(Json(
        json!({ "status": "cancelled", "run_id": path.run_id }),
    ))
}

async fn get_run_diff(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
) -> Result<Json<Value>, ApiError> {
    let diff = state
        .db
        .get_run_diff(&path.run_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "diff": diff.unwrap_or_default() })))
}

async fn get_run_git_status(
    State(state): State<AppState>,
    Path(path): Path<RunPath>,
) -> Result<Json<Value>, ApiError> {
    let run = state.db.get_run_by_id(&path.run_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Run not found"))?;
    let task = state.db.get_task_by_id(&run.task_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found"))?;
    let repo = state.db.get_repo_by_id(&task.repo_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found"))?;

    let working_dir = run.worktree_path.as_deref().unwrap_or(&repo.path);
    let info = git_status_info(working_dir, &repo.default_branch, &run.branch_name)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
        "commits": info.commits,
        "diffStat": info.diff_stat,
        "ahead": info.ahead,
        "behind": info.behind,
    })))
}

/// Shared helper: spawn a follow-up agent run, optionally resuming a Claude session.
pub(crate) async fn spawn_resume_run(
    agent_command: String,
    prompt: String,
    agent_working_dir: String,
    session_id: Option<String>,
    run_id: String,
    task_id: String,
    repo_path: String,
    db: Arc<Db>,
    pm: Arc<ProcessManager>,
    store: Arc<MsgStore>,
    event_meta: Value,
) {
    let agent_kind = if agent_command.to_lowercase().contains("claude") {
        "claude"
    } else {
        "other"
    };

    let spawn_result = if agent_kind == "claude" && session_id.is_some() {
        let sid = session_id.unwrap();
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

        match cmd.group_spawn() {
            Ok(mut child) => {
                if let Some(mut stdin) = child.inner().stdin.take() {
                    tokio::spawn(async move {
                        let _ = stdin.shutdown().await;
                    });
                }
                if let Some(stdout) = child.inner().stdout.take() {
                    let sc = store.clone();
                    tokio::spawn(async move {
                        let reader = tokio::io::BufReader::new(stdout);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if let Some((msg, sid)) =
                                crate::executor::parse_claude_stream_json_pub(&line)
                            {
                                if let Some(s) = sid {
                                    sc.set_session_id(s).await;
                                }
                                sc.push(msg).await;
                                continue;
                            }
                            sc.push_stdout(line).await;
                        }
                    });
                }
                if let Some(stderr) = child.inner().stderr.take() {
                    let sc = store.clone();
                    tokio::spawn(async move {
                        let reader = tokio::io::BufReader::new(stderr);
                        let mut lines = reader.lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            sc.push_stderr(line).await;
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
            let _ = db.add_run_event(&run_id, "agent_spawned", &event_meta);
            pm.attach_child(&run_id, child).await;
            pm.spawn_exit_monitor(run_id, task_id, repo_path, agent_working_dir, db)
                .await;
        }
        Err(e) => {
            store
                .push_stderr(format!("Failed to spawn agent: {}", e))
                .await;
            store.push_finished(None, "failed").await;
            let _ = db.add_run_event(&run_id, "run_failed", &json!({ "error": e.to_string() }));
            let _ = db.update_run_status(&run_id, "failed", true);
        }
    }
}
