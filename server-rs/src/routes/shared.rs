use std::env;

use serde::Deserialize;

use crate::AppState;
use crate::errors::ApiError;
use crate::models::{AgentProfile, TaskWithPayload};

// ── Shared Path / Query / Payload structs ──

#[derive(Debug, Deserialize)]
pub(crate) struct TaskPath {
    #[serde(rename = "task_id")]
    pub task_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RepoQuery {
    #[serde(rename = "repoId")]
    pub repo_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TaskQuery {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StartRunPayload {
    #[serde(rename = "planId")]
    pub plan_id: Option<String>,
    #[serde(rename = "taskId")]
    pub task_id: Option<String>,
    #[serde(rename = "profileId")]
    pub profile_id: Option<String>,
    #[serde(rename = "branchName")]
    pub branch_name: Option<String>,
}

// ── Utility functions ──

pub(crate) fn is_todo_lane_status(status: &str) -> bool {
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

pub(crate) fn sanitize_branch_segment(input: &str) -> String {
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

pub(crate) fn home_dir() -> std::path::PathBuf {
    env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/"))
}

/// Look up the agent command for a repo's preferred agent profile.
pub(crate) fn resolve_agent_command(state: &AppState, repo_id: &str) -> Option<String> {
    let pref = state.db.get_repo_agent_preference(repo_id).ok()??;
    let profile = state
        .db
        .get_agent_profile_by_id(&pref.agent_profile_id)
        .ok()??;
    Some(build_agent_command(&profile))
}

/// 3-tier profile resolution: explicit payload > task override > repo default.
pub(crate) fn resolve_agent_profile(
    state: &AppState,
    explicit_profile_id: Option<&str>,
    task: &TaskWithPayload,
) -> Result<AgentProfile, ApiError> {
    if let Some(profile_id) = explicit_profile_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return state
            .db
            .get_agent_profile_by_id(profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Agent profile not found."));
    }
    if let Some(ref task_profile_id) = task.agent_profile_id {
        return state
            .db
            .get_agent_profile_by_id(task_profile_id)
            .map_err(ApiError::internal)?
            .ok_or_else(|| ApiError::bad_request("Task agent profile not found."));
    }
    let pref = state
        .db
        .get_repo_agent_preference(&task.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Select an AI profile for this repo."))?;
    state
        .db
        .get_agent_profile_by_id(&pref.agent_profile_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::bad_request("Agent profile not found."))
}

pub(crate) fn build_agent_command(profile: &crate::models::AgentProfile) -> String {
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
    if provider.contains("claude")
        || provider.contains("gemini")
        || provider.contains("cursor")
    {
        return format!("{command} --model {model}");
    }

    command.to_string()
}

pub(crate) fn enqueue_autostart_if_enabled(
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

pub(crate) fn plan_store_key(job_id: &str) -> String {
    format!("plan-job:{job_id}")
}
