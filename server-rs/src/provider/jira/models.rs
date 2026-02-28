pub struct JiraMe {
    pub account_id: String,
    pub display_name: String,
    pub email_address: Option<String>,
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

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
