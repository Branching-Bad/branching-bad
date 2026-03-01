use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::msg_store::{LogMsg, MsgStore};
use super::shared::{TaskPath, build_agent_command, resolve_agent_profile};
use super::runs::spawn_resume_run;

pub(crate) fn chat_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/tasks/{task_id}/chat",
            post(send_chat_message).get(get_chat_messages),
        )
        .route(
            "/api/tasks/{task_id}/chat/queued",
            axum::routing::delete(cancel_queued_chat),
        )
        .route(
            "/api/tasks/{task_id}/chat/queue-status",
            get(chat_queue_status),
        )
        .route(
            "/api/tasks/{task_id}/chat/dispatch-next",
            post(dispatch_next_queued_chat),
        )
}

#[derive(Debug, Deserialize)]
struct SendChatPayload {
    content: String,
    #[serde(rename = "profileId")]
    profile_id: Option<String>,
}

async fn send_chat_message(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Json(payload): Json<SendChatPayload>,
) -> Result<Json<Value>, ApiError> {
    let content = payload.content.trim().to_string();
    if content.is_empty() {
        return Err(ApiError::bad_request("Message content is required."));
    }

    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    let mut chat_msg = state
        .db
        .insert_chat_message(&task.id, "user", &content, "sent")
        .map_err(ApiError::internal)?;

    let is_running = state
        .db
        .has_running_run_for_task(&task.id)
        .map_err(ApiError::internal)?;

    if is_running {
        state
            .db
            .update_chat_message_status(&chat_msg.id, "queued", None)
            .map_err(ApiError::internal)?;
        chat_msg.status = "queued".to_string();
        return Ok(Json(json!({ "chatMessage": chat_msg, "run": null })));
    }

    let latest_run = state
        .db
        .get_latest_run_by_task(&task.id)
        .map_err(ApiError::internal)?;

    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    let profile = resolve_agent_profile(&state, payload.profile_id.as_deref(), &task)?;

    let agent_command = build_agent_command(&profile);

    let (plan_id, branch_name, session_id, worktree_path) = match &latest_run {
        Some(run) => (
            run.plan_id.clone(),
            run.branch_name.clone(),
            run.agent_session_id.clone(),
            run.worktree_path.clone(),
        ),
        None => {
            return Err(ApiError::bad_request(
                "No previous run found to follow up on.",
            ));
        }
    };

    let run = state
        .db
        .create_run(
            &task.id,
            &plan_id,
            "running",
            &branch_name,
            Some(&profile.id),
            worktree_path.as_deref(),
        )
        .map_err(ApiError::internal)?;

    state
        .db
        .update_run_chat_message_id(&run.id, &chat_msg.id)
        .map_err(ApiError::internal)?;

    state
        .db
        .update_chat_message_status(&chat_msg.id, "dispatched", Some(&run.id))
        .map_err(ApiError::internal)?;
    chat_msg.status = "dispatched".to_string();
    chat_msg.result_run_id = Some(run.id.clone());

    let _ = state.db.update_task_status(&task.id, "IN_PROGRESS");

    let run_response = json!({ "id": run.id, "status": run.status, "branch_name": run.branch_name });

    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let repo_path = repo.path.clone();
    let agent_working_dir = worktree_path.unwrap_or_else(|| repo.path.clone());
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;

    tokio::spawn(async move {
        store.push(LogMsg::TurnSeparator).await;
        store.push(LogMsg::UserMessage(content.clone())).await;
        store
            .push(LogMsg::AgentText(
                "Starting follow-up run...".to_string(),
            ))
            .await;
        spawn_resume_run(
            agent_command.clone(),
            content,
            agent_working_dir,
            session_id,
            run_id,
            task_id,
            repo_path,
            db,
            pm,
            store,
            json!({ "command": agent_command, "isChatFollowUp": true }),
        )
        .await;
    });

    Ok(Json(
        json!({ "chatMessage": chat_msg, "run": run_response }),
    ))
}

async fn get_chat_messages(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let messages = state
        .db
        .get_chat_messages(&path.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "messages": messages })))
}

async fn cancel_queued_chat(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let deleted = state
        .db
        .delete_queued_chat_messages(&path.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn chat_queue_status(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let queued_count = state
        .db
        .count_queued_chat_messages(&path.task_id)
        .map_err(ApiError::internal)?;
    let is_running = state
        .db
        .has_running_run_for_task(&path.task_id)
        .map_err(ApiError::internal)?;
    Ok(Json(
        json!({ "queuedCount": queued_count, "isRunning": is_running }),
    ))
}

async fn dispatch_next_queued_chat(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let is_running = state
        .db
        .has_running_run_for_task(&path.task_id)
        .map_err(ApiError::internal)?;
    if is_running {
        return Ok(Json(
            json!({ "dispatched": false, "reason": "run_active" }),
        ));
    }

    let chat_msg = match state
        .db
        .get_next_queued_chat_message(&path.task_id)
        .map_err(ApiError::internal)?
    {
        Some(msg) => msg,
        None => return Ok(Json(json!({ "dispatched": false, "reason": "no_queued" }))),
    };

    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    let latest_run = state
        .db
        .get_latest_run_by_task(&task.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("No previous run found."))?;

    let repo = state
        .db
        .get_repo_by_id(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;

    let profile = resolve_agent_profile(&state, None, &task)?;
    let agent_command = build_agent_command(&profile);
    let content = chat_msg.content.clone();

    let plan_id = latest_run.plan_id.clone();
    let branch_name = latest_run.branch_name.clone();
    let session_id = latest_run.agent_session_id.clone();
    let worktree_path = latest_run.worktree_path.clone();

    let run = state
        .db
        .create_run(
            &task.id,
            &plan_id,
            "running",
            &branch_name,
            Some(&profile.id),
            worktree_path.as_deref(),
        )
        .map_err(ApiError::internal)?;

    state
        .db
        .update_run_chat_message_id(&run.id, &chat_msg.id)
        .map_err(ApiError::internal)?;
    state
        .db
        .update_chat_message_status(&chat_msg.id, "dispatched", Some(&run.id))
        .map_err(ApiError::internal)?;
    let _ = state.db.update_task_status(&task.id, "IN_PROGRESS");

    let run_response = json!({ "id": run.id, "status": run.status, "branch_name": run.branch_name });

    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let repo_path = repo.path.clone();
    let agent_working_dir = worktree_path.unwrap_or_else(|| repo.path.clone());
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;

    tokio::spawn(async move {
        store.push(LogMsg::TurnSeparator).await;
        store.push(LogMsg::UserMessage(content.clone())).await;
        store
            .push(LogMsg::AgentText(
                "Dispatching queued follow-up...".to_string(),
            ))
            .await;
        spawn_resume_run(
            agent_command.clone(),
            content,
            agent_working_dir,
            session_id,
            run_id,
            task_id,
            repo_path,
            db,
            pm,
            store,
            json!({ "command": agent_command, "isChatFollowUp": true }),
        )
        .await;
    });

    Ok(Json(
        json!({ "dispatched": true, "chatMessage": chat_msg, "run": run_response }),
    ))
}
