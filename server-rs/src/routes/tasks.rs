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
use crate::provider::jira::JiraClient;
use super::shared::{
    TaskPath, RepoQuery,
    is_todo_lane_status, enqueue_autostart_if_enabled,
};

pub(crate) fn task_routes() -> Router<AppState> {
    Router::new()
        .route("/api/tasks/sync", post(sync_tasks))
        .route("/api/tasks", get(list_tasks).post(create_task))
        .route(
            "/api/tasks/{task_id}",
            axum::routing::patch(update_task).delete(delete_task_handler),
        )
        .route(
            "/api/tasks/{task_id}/status",
            axum::routing::patch(update_task_status_handler),
        )
        .route(
            "/api/tasks/{task_id}/autostart/requeue",
            post(requeue_task_autostart),
        )
        .route(
            "/api/tasks/{task_id}/pipeline/clear",
            post(clear_task_pipeline),
        )
        .route("/api/pipeline/clear-all", post(clear_all_pipelines))
}

#[derive(Debug, Deserialize)]
struct SyncTasksPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
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
    #[serde(rename = "agentProfileId")]
    agent_profile_id: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskStatusPayload {
    status: String,
}

async fn sync_tasks(
    State(state): State<AppState>,
    Json(payload): Json<SyncTasksPayload>,
) -> Result<Json<Value>, ApiError> {
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
        if had_jira_tasks_before
            && transition.is_new
            && is_todo_lane_status(&transition.current_status)
        {
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

    let agent_profile_id = match payload.agent_profile_id {
        Some(Some(ref v)) => {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        Some(None) => None,
        None => task.agent_profile_id.clone(),
    };

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
            agent_profile_id.as_deref(),
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

async fn clear_all_pipelines(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
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
