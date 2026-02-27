use anyhow::{Context, Result, anyhow};
use reqwest::{Client, header};
use serde_json::Value;

use crate::models::SentryOrg;

pub struct SentryClient {
    client: Client,
    base_url: String,
    org_slug: String,
    auth_token: String,
}

#[allow(dead_code)]
pub struct SentryProjectInfo {
    pub slug: String,
    pub name: String,
    pub id: String,
}

pub struct SentryIssue {
    pub id: String,
    pub title: String,
    pub culprit: Option<String>,
    pub level: Option<String>,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub count: i64,
    pub metadata: Value,
}

impl SentryClient {
    pub fn new(base_url: &str, org_slug: &str, auth_token: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            org_slug: org_slug.to_string(),
            auth_token: auth_token.to_string(),
        }
    }

    /// GET /api/0/organizations/{org}/ — validate token
    pub async fn validate_credentials(&self) -> Result<SentryOrg> {
        let payload = self
            .get_json(
                &format!("/api/0/organizations/{}/", self.org_slug),
                &[],
            )
            .await?;
        Ok(SentryOrg {
            slug: payload
                .get("slug")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
    }

    /// GET /api/0/organizations/{org}/projects/ — list projects
    pub async fn list_projects(&self) -> Result<Vec<SentryProjectInfo>> {
        let mut all = Vec::new();
        let cursor: Option<String> = None;

        loop {
            let mut query: Vec<(&str, String)> = vec![];
            if let Some(ref c) = cursor {
                query.push(("cursor", c.clone()));
            }
            let payload = self
                .get_json(
                    &format!("/api/0/organizations/{}/projects/", self.org_slug),
                    &query,
                )
                .await?;

            let items = payload.as_array().cloned().unwrap_or_default();
            if items.is_empty() {
                break;
            }
            for item in &items {
                let slug = item
                    .get("slug")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&slug)
                    .to_string();
                let id = item
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !slug.is_empty() {
                    all.push(SentryProjectInfo { slug, name, id });
                }
            }
            // Simple pagination: if we got results, try next page
            // Sentry uses Link header for cursor pagination but for simplicity
            // we stop if fewer than 100 results
            if items.len() < 100 {
                break;
            }
            // We'd need to parse Link header for proper cursor — skip for now
            break;
        }
        Ok(all)
    }

    /// Fetch unresolved issues for a project, optionally since a given timestamp
    pub async fn fetch_new_issues(
        &self,
        project_slug: &str,
        since: Option<&str>,
    ) -> Result<Vec<SentryIssue>> {
        let mut query_str = "is:unresolved".to_string();
        if let Some(since_ts) = since {
            query_str.push_str(&format!(" lastSeen:>{since_ts}"));
        }

        let query = vec![
            ("query", query_str),
            ("project", project_slug.to_string()),
            ("sort", "date".to_string()),
            ("limit", "100".to_string()),
        ];
        let payload = self
            .get_json(
                &format!("/api/0/organizations/{}/issues/", self.org_slug),
                &query
                    .iter()
                    .map(|(k, v)| (*k, v.clone()))
                    .collect::<Vec<_>>(),
            )
            .await?;

        let items = payload.as_array().cloned().unwrap_or_default();
        let mut issues = Vec::new();
        for item in items {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let count = item
                .get("count")
                .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()))
                .unwrap_or(1);
            issues.push(SentryIssue {
                id,
                title: item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled")
                    .to_string(),
                culprit: item
                    .get("culprit")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string),
                level: item
                    .get("level")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                first_seen: item
                    .get("firstSeen")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                last_seen: item
                    .get("lastSeen")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                count,
                metadata: item
                    .get("metadata")
                    .cloned()
                    .unwrap_or(Value::Null),
            });
        }
        Ok(issues)
    }

    /// GET /api/0/issues/{issue_id}/events/latest/ — latest event with stack trace
    pub async fn fetch_latest_event(&self, issue_id: &str) -> Result<Value> {
        self.get_json(&format!("/api/0/issues/{issue_id}/events/latest/"), &[])
            .await
    }

    async fn get_json(&self, endpoint: &str, query: &[(&str, String)]) -> Result<Value> {
        let mut request = self
            .client
            .get(format!("{}{}", self.base_url, endpoint))
            .header(header::ACCEPT, "application/json")
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", self.auth_token),
            );
        if !query.is_empty() {
            request = request.query(query);
        }

        let response = request
            .send()
            .await
            .with_context(|| format!("sentry request failed: {endpoint}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Sentry request failed ({status}): {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        response
            .json::<Value>()
            .await
            .context("sentry response decode failed")
    }
}
