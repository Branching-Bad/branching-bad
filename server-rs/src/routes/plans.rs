use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
};
use futures::stream::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::models::{PlanJob, TaskWithPayload};
use crate::msg_store::{LogMsg, MsgStore};
use crate::planner::{
    generate_plan_and_tasklist_with_agent_strict, validate_tasklist_payload,
};
use super::shared::{
    StartRunPayload, TaskQuery,
    enqueue_autostart_if_enabled, plan_store_key, resolve_agent_command,
};
use super::runs::start_run;

pub(crate) fn plan_routes() -> Router<AppState> {
    Router::new()
        .route("/api/plans/create", post(create_plan))
        .route("/api/plans", get(list_plans))
        .route("/api/plans/jobs/latest", get(get_latest_plan_job_for_task))
        .route("/api/plans/jobs/{job_id}", get(get_plan_job))
        .route("/api/plans/jobs/{job_id}/ws", get(super::runs::plan_job_ws_handler))
        .route("/api/plans/{plan_id}/action", post(plan_action))
        .route(
            "/api/plans/{plan_id}/manual-revision",
            post(create_manual_plan_revision),
        )
        .route("/api/plans/{plan_id}/review", post(review_plan))
}

#[derive(Debug, Deserialize)]
struct CreatePlanPayload {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "revisionComment")]
    revision_comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlanPath {
    #[serde(rename = "plan_id")]
    plan_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PlanJobPath {
    #[serde(rename = "job_id")]
    pub job_id: String,
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
    #[serde(rename = "tasklistJson")]
    tasklist_json: Value,
    comment: Option<String>,
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

    if job.status == "pending"
        && state
            .process_manager
            .get_store(&plan_store_key(&job.id))
            .await
            .is_none()
    {
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

    Ok((StatusCode::ACCEPTED, Json(json!({ "job": job }))))
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
            let agent_command =
                resolve_agent_command(&state, &task.repo_id).ok_or_else(|| {
                    ApiError::bad_request(
                        "Select an AI profile for this repo before plan revision.",
                    )
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
                    &revised.tasklist_json,
                    1,
                    "revise",
                    None,
                    "agent",
                )
                .map_err(ApiError::internal)?;
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

    validate_tasklist_payload(&payload.tasklist_json, &task.jira_issue_key, target_version)
        .map_err(ApiError::bad_request_from)?;

    let new_plan = state
        .db
        .create_plan(
            &task.id,
            "drafted",
            &payload.plan_markdown,
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

// ── Review plan with AI ──

#[derive(Debug, Deserialize)]
struct ReviewPlanPayload {
    #[serde(rename = "profileId")]
    profile_id: String,
}

async fn review_plan(
    State(state): State<AppState>,
    Path(path): Path<PlanPath>,
    Json(payload): Json<ReviewPlanPayload>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError> {
    let plan = state
        .db
        .get_plan_by_id(&path.plan_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Plan not found."))?;
    let task = state
        .db
        .get_task_by_id(&plan.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;
    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Task repo not found."))?;
    let profile = state
        .db
        .get_agent_profile_by_id(&payload.profile_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Agent profile not found."))?;
    let agent_command = super::shared::build_agent_command(&profile);

    let prompt = format!(
        "You are a senior software architect reviewing an implementation plan.\n\
         IMPORTANT: You are ONLY providing feedback. Do NOT take any action, do NOT modify any files, \
         do NOT execute any commands. Your ONLY job is to review and return a JSON verdict.\n\n\
         ## Task\n\
         **Key:** {issue_key}\n\
         **Title:** {title}\n\
         **Priority:** {priority}\n\
         **Description:** {description}\n\n\
         ## Task Payload (raw source data)\n\
         ```json\n{task_payload}\n```\n\n\
         ## Plan\n\
         {plan_md}\n\n\
         ## Tasklist (JSON)\n\
         ```json\n{tasklist_json}\n```\n\n\
         Review this plan for completeness, risks, architecture, scope, and task ordering.\n\n\
         Return ONLY a valid JSON object in this exact format, nothing else:\n\
         ```json\n\
         {{\n\
           \"verdict\": \"passed\" or \"failed\",\n\
           \"comments\": [\n\
             // If verdict is \"passed\": leave empty array []\n\
             // If verdict is \"failed\": include objects like below\n\
             {{\n\
               \"category\": \"completeness\" | \"risk\" | \"architecture\" | \"scope\" | \"ordering\",\n\
               \"severity\": \"critical\" | \"major\" | \"minor\",\n\
               \"reason\": \"Why this is a problem\",\n\
               \"suggestion\": \"What should be changed or improved\"\n\
             }}\n\
           ]\n\
         }}\n\
         ```\n\n\
         Rules:\n\
         - If the plan adequately covers the task requirements, return verdict \"passed\" with empty comments.\n\
         - If there are issues, return verdict \"failed\" with comments explaining each problem.\n\
         - Each comment MUST include: category, severity, reason, and suggestion.\n\
         - Be concise and actionable. Focus on real problems, not style preferences.\n\
         - Return ONLY the JSON. No markdown fences, no extra text.",
        issue_key = task.jira_issue_key,
        title = task.title,
        priority = task.priority.as_deref().unwrap_or("unset"),
        description = task.description.as_deref().unwrap_or("(no description)"),
        task_payload = serde_json::to_string_pretty(&task.payload).unwrap_or_default(),
        plan_md = if plan.plan_markdown.is_empty() { "(empty)" } else { &plan.plan_markdown },
        tasklist_json = serde_json::to_string_pretty(&plan.tasklist).unwrap_or_default(),
    );

    let repo_path = repo.path.clone();
    let cmd = agent_command.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(256);

    tokio::task::spawn_blocking(move || {
        let tx_progress = tx.clone();
        let progress_cb = move |msg: LogMsg| {
            let text = match &msg {
                LogMsg::AgentText(s) | LogMsg::Thinking(s) | LogMsg::Stdout(s) => s.clone(),
                LogMsg::Stderr(s) => s.clone(),
                LogMsg::ToolUse { tool, .. } => format!("[tool: {}]", tool),
                LogMsg::ToolResult { tool, .. } => format!("[result: {}]", tool),
                LogMsg::Finished { status, .. } => format!("[finished: {}]", status),
                _ => return,
            };
            let _ = tx_progress.blocking_send(json!({ "type": "log", "text": text }).to_string());
        };

        let result = crate::planner::invoke_agent_cli(&cmd, &prompt, &repo_path, Some(&progress_cb), None);
        match result {
            Ok(output) => {
                let _ = tx.blocking_send(json!({ "type": "done", "feedback": output.text }).to_string());
            }
            Err(e) => {
                let _ = tx.blocking_send(json!({ "type": "error", "message": e.to_string() }).to_string());
            }
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(|data| {
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ── Plan generation helpers ──

fn sanitize_log_segment(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn open_plan_debug_log_file(
    repo_path: &str,
    issue_key: &str,
    job_id: &str,
) -> (Option<File>, Option<String>) {
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

    let log_dir = PathBuf::from(repo_path)
        .join(".branching-bad")
        .join("plan-logs");
    if let Err(error) = fs::create_dir_all(&log_dir) {
        eprintln!(
            "Warning: failed to create plan log dir {}: {error}",
            log_dir.display()
        );
        return (None, None);
    }

    let log_path = log_dir.join(format!("{issue_short}-{job_short}.log"));
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(file) => (Some(file), Some(log_path.to_string_lossy().to_string())),
        Err(error) => {
            eprintln!(
                "Warning: failed to open plan log file {}: {error}",
                log_path.display()
            );
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
}

pub(crate) fn spawn_plan_generation_job(
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
            state
                .db
                .get_latest_completed_plan_job_session(&task.id)
                .ok()
                .flatten()
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
        let _ = state.db.complete_plan_job(
            &job.id,
            Some(&plan.id),
            generated.agent_session_id.as_deref(),
        );
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
                    autostart_handled = true;
                    store
                        .push(LogMsg::AgentText(
                            "Starting run after auto-approval...".to_string(),
                        ))
                        .await;
                    write_plan_debug_log(
                        &mut debug_log_file,
                        "starting run after auto-approval (inline)",
                    );
                    match start_run(
                        State(state.clone()),
                        Json(StartRunPayload {
                            plan_id: Some(plan.id.clone()),
                            task_id: None,
                            profile_id: None,
                            branch_name: None,
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
                                &format!(
                                    "autostart job completed with run_id={}",
                                    run_id.as_deref().unwrap_or("?")
                                ),
                            );
                        }
                        Err(error) if error.status == StatusCode::CONFLICT => {
                            let _ = state.db.requeue_autostart_job(
                                ast_job_id,
                                Some(&format!(
                                    "conflict after auto-approve: {}",
                                    error.message
                                )),
                            );
                            store
                                .push(LogMsg::AgentText(format!(
                                    "Run conflict, requeued: {}",
                                    error.message
                                )))
                                .await;
                            write_plan_debug_log(
                                &mut debug_log_file,
                                &format!(
                                    "autostart requeued due to conflict: {}",
                                    error.message
                                ),
                            );
                        }
                        Err(error) => {
                            let msg = format!(
                                "autostart run failed after auto-approve: {}",
                                error.message
                            );
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
                    let _ = state
                        .db
                        .enqueue_autostart_job(&task.id, "auto_approve");
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

        if let Some(ref ast_job_id) = autostart_job_id {
            if !autostart_handled {
                let _ = state
                    .db
                    .complete_autostart_job(ast_job_id, Some(&plan.id), None);
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
