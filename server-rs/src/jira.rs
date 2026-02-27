use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use reqwest::{Client, header};
use serde_json::Value;

use crate::models::{JiraIssueForTask, JiraMe};

pub struct JiraClient {
    client: Client,
    base_url: String,
    email: String,
    api_token: String,
}

impl JiraClient {
    pub fn new(base_url: &str, email: &str, api_token: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            email: email.to_string(),
            api_token: api_token.to_string(),
        }
    }

    pub async fn validate_credentials(&self) -> Result<JiraMe> {
        let payload = self.get_json("/rest/api/3/myself", &[]).await?;
        Ok(JiraMe {
            account_id: payload
                .get("accountId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            display_name: payload
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            email_address: payload
                .get("emailAddress")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        })
    }

    pub async fn fetch_boards(&self) -> Result<Vec<(String, String)>> {
        let mut all = Vec::new();
        let max_results = 50usize;
        let mut start_at = 0usize;

        loop {
            let query = [
                ("startAt", start_at.to_string()),
                ("maxResults", max_results.to_string()),
                ("type", "scrum,kanban".to_string()),
            ];
            let payload = self.get_json("/rest/agile/1.0/board", &query).await?;
            let values = payload
                .get("values")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for item in values.iter() {
                let id = item
                    .get("id")
                    .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(ToString::to_string)))
                    .unwrap_or_default();
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Unnamed board")
                    .to_string();
                if !id.is_empty() {
                    all.push((id, name));
                }
            }

            let is_last = payload
                .get("isLast")
                .and_then(Value::as_bool)
                .unwrap_or(values.len() < max_results);
            if is_last || values.len() < max_results {
                break;
            }
            start_at += max_results;
        }
        Ok(all)
    }

    pub async fn fetch_assigned_board_issues(
        &self,
        board_id: &str,
        jql: Option<&str>,
    ) -> Result<Vec<JiraIssueForTask>> {
        let default_jql =
            "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC";
        let query = [
            ("maxResults", "100".to_string()),
            (
                "fields",
                "summary,description,status,priority,assignee,updated".to_string(),
            ),
            ("jql", jql.unwrap_or(default_jql).to_string()),
        ];
        let payload = self
            .get_json(&format!("/rest/agile/1.0/board/{board_id}/issue"), &query)
            .await?;
        let issues = payload
            .get("issues")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mapped = issues
            .into_iter()
            .map(|issue| {
                let key = issue
                    .get("key")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let fields = issue
                    .get("fields")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();

                let title = fields
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| key.as_str())
                    .to_string();
                let description = map_description(fields.get("description"));
                let assignee = fields
                    .get("assignee")
                    .and_then(Value::as_object)
                    .and_then(|obj| {
                        obj.get("displayName")
                            .and_then(Value::as_str)
                            .or_else(|| obj.get("emailAddress").and_then(Value::as_str))
                    })
                    .map(ToString::to_string);
                let status = map_status(fields.get("status"));
                let priority = fields
                    .get("priority")
                    .and_then(Value::as_object)
                    .and_then(|obj| obj.get("name").and_then(Value::as_str))
                    .map(ToString::to_string);

                JiraIssueForTask {
                    jira_issue_key: key,
                    title,
                    description,
                    assignee,
                    status,
                    priority,
                    payload: issue,
                }
            })
            .collect::<Vec<_>>();
        Ok(mapped)
    }

    async fn get_json(&self, endpoint: &str, query: &[(&str, String)]) -> Result<Value> {
        let mut request = self
            .client
            .get(format!("{}{}", self.base_url, endpoint))
            .header(header::ACCEPT, "application/json");
        if !query.is_empty() {
            request = request.query(query);
        }
        let auth = format!("{}:{}", self.email, self.api_token);
        let basic = general_purpose::STANDARD.encode(auth.as_bytes());
        request = request.header(header::AUTHORIZATION, format!("Basic {basic}"));

        let response = request
            .send()
            .await
            .with_context(|| format!("jira request failed: {endpoint}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Jira request failed ({status}): {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        response
            .json::<Value>()
            .await
            .context("jira response decode failed")
    }
}

fn map_status(raw: Option<&Value>) -> String {
    let status_obj = raw.and_then(Value::as_object);
    let category = status_obj
        .and_then(|obj| obj.get("statusCategory"))
        .and_then(Value::as_object)
        .and_then(|obj| obj.get("key"))
        .and_then(Value::as_str)
        .unwrap_or("");
    match category {
        "done" => "done".to_string(),
        "indeterminate" => "inprogress".to_string(),
        "new" => "todo".to_string(),
        _ => status_obj
            .and_then(|obj| obj.get("name"))
            .and_then(Value::as_str)
            .map(|s| s.to_lowercase().replace(' ', "_"))
            .unwrap_or_else(|| "unknown".to_string()),
    }
}

fn map_description(raw: Option<&Value>) -> Option<String> {
    let value = raw?;
    if let Some(as_str) = value.as_str() {
        return Some(as_str.to_string());
    }
    Some(value.to_string())
}

