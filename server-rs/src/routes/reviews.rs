use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::errors::ApiError;
use crate::executor::{
    apply_branch_to_base_unstaged, apply_merge_no_ff, apply_rebase,
    apply_worktree_to_base_unstaged,
    detect_base_branch_with_default, git_commit_all, git_push, gh_create_pr, has_gh_cli,
    ApplyError,
};
use crate::models::{TaskWithPayload, Run, Repo};
use crate::msg_store::{LogMsg, MsgStore};
use super::shared::{TaskPath, build_agent_command};
use super::runs::spawn_resume_run;

pub(crate) fn review_routes() -> Router<AppState> {
    Router::new()
        .route("/api/tasks/{task_id}/review", post(submit_review))
        .route("/api/tasks/{task_id}/reviews", get(list_reviews))
        .route("/api/tasks/{task_id}/complete", post(complete_task))
        .route("/api/tasks/{task_id}/apply-to-main", post(apply_to_main))
        .route("/api/tasks/{task_id}/push", post(push_branch))
        .route("/api/tasks/{task_id}/create-pr", post(create_pr))
}

#[derive(Debug, Deserialize)]
struct LineCommentPayload {
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "lineStart")]
    line_start: i64,
    #[serde(rename = "lineEnd")]
    line_end: i64,
    #[serde(rename = "diffHunk")]
    diff_hunk: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct SubmitReviewPayload {
    comment: Option<String>,
    #[serde(rename = "profileId")]
    profile_id: Option<String>,
    mode: Option<String>,
    #[serde(rename = "lineComments")]
    line_comments: Option<Vec<LineCommentPayload>>,
}

async fn submit_review(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    Json(payload): Json<SubmitReviewPayload>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let comment_text = payload.comment.as_deref().unwrap_or("").trim().to_string();
    let line_comments = payload.line_comments.unwrap_or_default();
    let review_mode = payload.mode.as_deref().unwrap_or("instant").to_string();

    if comment_text.is_empty() && line_comments.is_empty() {
        return Err(ApiError::bad_request("Comment or line comments required."));
    }

    let task = state
        .db
        .get_task_by_id(&path.task_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;

    if task.status != "IN_REVIEW" {
        return Err(ApiError::bad_request(
            "Task must be in IN_REVIEW status to submit feedback.",
        ));
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

    let batch_id = if review_mode == "batch" && !line_comments.is_empty() {
        Some(Uuid::new_v4().to_string())
    } else {
        None
    };

    let mut stored_line_comments = Vec::new();
    for lc in &line_comments {
        let rc = state
            .db
            .add_review_comment_full(
                &task.id,
                &latest_run.id,
                &lc.text,
                Some(&lc.file_path),
                Some(lc.line_start),
                Some(lc.line_end),
                Some(&lc.diff_hunk),
                &review_mode,
                batch_id.as_deref(),
            )
            .map_err(ApiError::internal)?;
        stored_line_comments.push(rc);
    }

    let review_comment = if !comment_text.is_empty() {
        let rc = state
            .db
            .add_review_comment_full(
                &task.id,
                &latest_run.id,
                &comment_text,
                None,
                None,
                None,
                None,
                &review_mode,
                batch_id.as_deref(),
            )
            .map_err(ApiError::internal)?;
        Some(rc)
    } else {
        None
    };

    for rc in &stored_line_comments {
        state
            .db
            .update_review_comment_status(&rc.id, "processing", None)
            .map_err(ApiError::internal)?;
    }
    if let Some(ref rc) = review_comment {
        state
            .db
            .update_review_comment_status(&rc.id, "processing", None)
            .map_err(ApiError::internal)?;
    }

    let primary_comment = review_comment
        .as_ref()
        .or(stored_line_comments.first())
        .cloned()
        .ok_or_else(|| ApiError::bad_request("No comments to submit."))?;

    let profile = if let Some(profile_id) = payload
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
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
        .update_run_review_comment_id(&run.id, &primary_comment.id)
        .map_err(ApiError::internal)?;

    for rc in &stored_line_comments {
        state
            .db
            .update_review_comment_status(&rc.id, "processing", Some(&run.id))
            .map_err(ApiError::internal)?;
    }
    if let Some(ref rc) = review_comment {
        state
            .db
            .update_review_comment_status(&rc.id, "processing", Some(&run.id))
            .map_err(ApiError::internal)?;
    }

    let response = json!({
        "reviewComment": primary_comment,
        "run": { "id": run.id, "status": run.status }
    });

    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let repo_path = repo.path.clone();
    let agent_working_dir = latest_run
        .worktree_path
        .clone()
        .unwrap_or_else(|| repo.path.clone());
    let session_id = latest_run.agent_session_id.clone();
    let db = state.db.clone();
    let pm = state.process_manager.clone();
    let store = MsgStore::new();
    pm.register_store(&run_id, store.clone()).await;

    let prompt = {
        let mut parts = Vec::new();
        parts.push("Review feedback on previous work:\n".to_string());

        for lc in &line_comments {
            let line_range = if lc.line_start == lc.line_end {
                format!("Line {}", lc.line_start)
            } else {
                format!("Lines {}-{}", lc.line_start, lc.line_end)
            };
            parts.push(format!("## File: {} ({})", lc.file_path, line_range));
            parts.push(format!("```\n{}\n```", lc.diff_hunk));
            parts.push(format!("> {}\n", lc.text));
        }

        if !comment_text.is_empty() {
            if !line_comments.is_empty() {
                parts.push("## General feedback".to_string());
            }
            parts.push(comment_text.clone());
        }

        parts.push("\nPlease address this feedback and make the necessary changes.".to_string());
        parts.join("\n")
    };

    tokio::spawn(async move {
        store
            .push(LogMsg::AgentText(
                "Starting review feedback run...".to_string(),
            ))
            .await;
        spawn_resume_run(
            agent_command.clone(),
            prompt,
            agent_working_dir,
            session_id,
            run_id,
            task_id,
            repo_path,
            db,
            pm,
            store,
            json!({ "command": agent_command, "isReviewRun": true }),
        )
        .await;
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
        return Err(ApiError::bad_request(
            "Task must be in IN_REVIEW status to complete.",
        ));
    }

    state
        .db
        .update_task_status(&path.task_id, "DONE")
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "status": "DONE", "taskId": path.task_id })))
}

#[derive(Debug, Deserialize)]
struct ApplyToMainPayload {
    #[serde(rename = "autoCommit", default)]
    auto_commit: bool,
    #[serde(rename = "commitMessage")]
    commit_message: Option<String>,
    #[serde(default = "default_squash")]
    strategy: String,
}

fn default_squash() -> String {
    "squash".to_string()
}

async fn apply_to_main(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
    body: Option<Json<ApplyToMainPayload>>,
) -> Result<Response, ApiError> {
    let payload = body.map(|j| j.0);
    let auto_commit = payload.as_ref().map(|p| p.auto_commit).unwrap_or(false);
    let commit_message = payload.as_ref().and_then(|p| p.commit_message.clone());
    let strategy = payload.as_ref().map(|p| p.strategy.as_str()).unwrap_or("squash");

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
        detect_base_branch_with_default(&repo.path, Some(&repo.default_branch)).map_err(|e| ApiError::bad_request(&e.to_string()))?;

    let apply_result = match strategy {
        "merge" => {
            apply_merge_no_ff(&repo.path, &run.branch_name, &base_branch, run.worktree_path.as_deref())
        }
        "rebase" => {
            apply_rebase(&repo.path, &run.branch_name, &base_branch, run.worktree_path.as_deref())
        }
        _ => {
            // Default: squash (existing behavior)
            if let Some(ref wt_path) = run.worktree_path {
                apply_worktree_to_base_unstaged(&repo.path, &run.branch_name, &base_branch, wt_path)
            } else {
                apply_branch_to_base_unstaged(&repo.path, &run.branch_name, &base_branch)
            }
        }
    };

    match apply_result {
        Ok(result) => {
            let mut committed = false;
            if auto_commit && result.files_changed > 0 {
                let msg = commit_message.unwrap_or_else(|| {
                    format!("feat({}): {}", task.jira_issue_key, task.title)
                });
                git_commit_all(&repo.path, &msg)
                    .map_err(ApiError::internal)?;
                committed = true;
            }
            Ok((
                StatusCode::OK,
                Json(json!({
                    "applied": true,
                    "filesChanged": result.files_changed,
                    "baseBranch": result.base_branch,
                    "committed": committed,
                    "strategy": strategy,
                })),
            )
                .into_response())
        }
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

/// Resolve task, latest run, and repo for a given task_id.
async fn resolve_task_run_repo(
    state: &AppState,
    task_id: &str,
) -> Result<(TaskWithPayload, Run, Repo), ApiError> {
    let task = state.db.get_task_by_id(task_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Task not found."))?;
    let run = state.db.get_latest_run_by_task(task_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("No run found for this task."))?;
    let repo = state.db.get_repo_by_id(&task.repo_id).map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found."))?;
    Ok((task, run, repo))
}

async fn push_branch(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    let (_task, run, repo) = resolve_task_run_repo(&state, &path.task_id).await?;

    if run.branch_name.is_empty() {
        return Err(ApiError::bad_request("No branch to push (direct mode)."));
    }

    let push_path = run.worktree_path.as_deref().unwrap_or(&repo.path);
    git_push(push_path, &run.branch_name).map_err(ApiError::internal)?;

    Ok(Json(json!({ "pushed": true, "branch": run.branch_name })))
}

async fn create_pr(
    State(state): State<AppState>,
    Path(path): Path<TaskPath>,
) -> Result<Json<Value>, ApiError> {
    if !has_gh_cli() {
        return Err(ApiError::bad_request("GitHub CLI (gh) is not installed."));
    }

    let (task, run, repo) = resolve_task_run_repo(&state, &path.task_id).await?;

    if run.branch_name.is_empty() {
        return Err(ApiError::bad_request("No branch for PR (direct mode)."));
    }

    let base_branch = detect_base_branch_with_default(&repo.path, Some(&repo.default_branch))
        .map_err(|e| ApiError::bad_request(&e.to_string()))?;

    // Push first
    let push_path = run.worktree_path.as_deref().unwrap_or(&repo.path);
    git_push(push_path, &run.branch_name).map_err(ApiError::internal)?;

    let title = format!("{}: {}", task.jira_issue_key, task.title);
    let body = task.description.as_deref().unwrap_or("").to_string();

    let pr_url = gh_create_pr(&repo.path, &title, &body, &base_branch)
        .map_err(ApiError::internal)?;

    let pr_number: Option<i64> = pr_url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse().ok());

    state.db.update_task_pr(&task.id, &pr_url, pr_number)
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
        "prUrl": pr_url,
        "prNumber": pr_number,
        "branch": run.branch_name,
    })))
}
