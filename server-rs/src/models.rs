use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraAccount {
    pub id: String,
    pub base_url: String,
    pub email: String,
    pub api_token: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraBoard {
    pub id: String,
    pub jira_account_id: String,
    pub board_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoBinding {
    pub repo_id: String,
    pub jira_account_id: String,
    pub jira_board_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWithPayload {
    pub id: String,
    pub repo_id: String,
    pub jira_account_id: Option<String>,
    pub jira_board_id: Option<String>,
    pub jira_issue_key: String,
    pub title: String,
    pub description: Option<String>,
    pub assignee: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    #[serde(default = "default_true")]
    pub require_plan: bool,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub auto_approve_plan: bool,
    pub last_pipeline_error: Option<String>,
    pub last_pipeline_at: Option<String>,
    pub source: String,
    pub payload: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskPayload {
    #[serde(rename = "repoId")]
    pub repo_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    #[serde(rename = "requirePlan")]
    pub require_plan: Option<bool>,
    #[serde(rename = "autoStart")]
    pub auto_start: Option<bool>,
    #[serde(rename = "autoApprovePlan")]
    pub auto_approve_plan: Option<bool>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub task_id: String,
    pub version: i64,
    pub status: String,
    pub plan_markdown: String,
    pub plan_json: String,
    pub tasklist_json: String,
    pub tasklist_schema_version: i64,
    pub generation_mode: String,
    pub validation_errors_json: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanWithParsed {
    pub id: String,
    pub task_id: String,
    pub version: i64,
    pub status: String,
    pub plan_markdown: String,
    pub plan: Value,
    pub tasklist: Value,
    pub tasklist_schema_version: i64,
    pub generation_mode: String,
    pub validation_errors: Option<Value>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanJob {
    pub id: String,
    pub task_id: String,
    pub mode: String,
    pub status: String,
    pub revision_comment: Option<String>,
    pub plan_id: Option<String>,
    pub error: Option<String>,
    pub agent_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutostartJob {
    pub id: String,
    pub task_id: String,
    pub trigger_kind: String,
    pub state: String,
    pub plan_id: Option<String>,
    pub run_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearPipelineResult {
    pub plan_jobs_failed: usize,
    pub autostart_jobs_failed: usize,
    pub task_reset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub task_id: String,
    pub plan_id: String,
    pub status: String,
    pub branch_name: String,
    pub agent_profile_id: Option<String>,
    pub pid: Option<i64>,
    pub exit_code: Option<i64>,
    pub agent_session_id: Option<String>,
    pub review_comment_id: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEvent {
    pub id: String,
    pub run_id: String,
    pub r#type: String,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub provider: String,
    pub agent_name: String,
    pub model: String,
    pub command: String,
    pub source: String,
    pub discovery_kind: String,
    pub metadata_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfileWithMetadata {
    pub id: String,
    pub provider: String,
    pub agent_name: String,
    pub model: String,
    pub command: String,
    pub source: String,
    pub discovery_kind: String,
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoAgentPreference {
    pub repo_id: String,
    pub agent_profile_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewComment {
    pub id: String,
    pub task_id: String,
    pub run_id: String,
    pub comment: String,
    pub status: String,
    pub result_run_id: Option<String>,
    pub addressed_at: Option<String>,
    pub created_at: String,
}

pub struct JiraMe {
    pub account_id: String,
    pub display_name: String,
    pub email_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryAccount {
    pub id: String,
    pub base_url: String,
    pub org_slug: String,
    pub auth_token: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryProject {
    pub id: String,
    pub sentry_account_id: String,
    pub project_slug: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoSentryBinding {
    pub repo_id: String,
    pub sentry_account_id: String,
    pub sentry_project_id: String,
    pub environments: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryIssueRecord {
    pub id: String,
    pub sentry_account_id: String,
    pub sentry_project_id: String,
    pub sentry_issue_id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: Option<String>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub occurrence_count: i64,
    pub environments: String,
    pub status: String,
    pub linked_task_id: Option<String>,
    pub latest_event_json: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct SentryOrg {
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProfile {
    pub provider: String,
    pub agent_name: String,
    pub model: String,
    pub command: String,
    pub source: String,
    pub discovery_kind: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraIssueForTask {
    pub jira_issue_key: String,
    pub title: String,
    pub description: Option<String>,
    pub assignee: Option<String>,
    pub status: String,
    pub priority: Option<String>,
    pub payload: Value,
}
