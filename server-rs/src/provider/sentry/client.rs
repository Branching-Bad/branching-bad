use anyhow::{Context, Result, anyhow};
use reqwest::{Client, header};
use serde_json::Value;

use super::models::{SentryIssue, SentryOrg, SentryProjectInfo};

pub struct SentryClient {
    client: Client,
    base_url: String,
    org_slug: String,
    auth_token: String,
}

impl SentryClient {
    pub fn new(base_url: &str, org_slug: &str, auth_token: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: normalize_sentry_url(base_url),
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
        let mut cursor: Option<String> = None;

        loop {
            let mut query: Vec<(&str, String)> = vec![];
            if let Some(ref c) = cursor {
                query.push(("cursor", c.clone()));
            }

            let response = self
                .get_with_headers(
                    &format!("/api/0/organizations/{}/projects/", self.org_slug),
                    &query,
                )
                .await?;

            let next_cursor = parse_link_cursor(&response.headers);
            let items = response.body.as_array().cloned().unwrap_or_default();
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
            match next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        Ok(all)
    }

    /// Fetch unresolved issues for a project, optionally since a given timestamp
    pub async fn fetch_new_issues(
        &self,
        project_slug: &str,
        since: Option<&str>,
    ) -> Result<Vec<SentryIssue>> {
        // Use project:<slug> in the search query instead of the numeric `project` param
        let mut query_str = format!("is:unresolved project:{project_slug}");
        if let Some(since_ts) = since {
            // Sentry lastSeen filter expects ISO 8601 without timezone offset
            // Our DB stores "2026-02-28T10:00:00+00:00", strip the +00:00 part
            let cleaned = since_ts
                .trim_end_matches("+00:00")
                .trim_end_matches('Z');
            query_str.push_str(&format!(" lastSeen:>{cleaned}"));
        }

        let query = vec![
            ("query", query_str),
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
        let resp = self.get_with_headers(endpoint, query).await?;
        Ok(resp.body)
    }

    async fn get_with_headers(
        &self,
        endpoint: &str,
        query: &[(&str, String)],
    ) -> Result<SentryResponse> {
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
        let headers = response.headers().clone();
        let body = response
            .json::<Value>()
            .await
            .context("sentry response decode failed")?;
        Ok(SentryResponse { headers, body })
    }
}

struct SentryResponse {
    headers: header::HeaderMap,
    body: Value,
}

/// Normalize Sentry URL: convert org subdomain URLs like
/// `https://melih-12.sentry.io` to `https://sentry.io`.
/// Self-hosted URLs (not *.sentry.io) are kept as-is.
fn normalize_sentry_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    // Match pattern: https://<something>.sentry.io
    if let Some(host) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
    {
        if host.ends_with(".sentry.io") && host != "sentry.io" {
            return "https://sentry.io".to_string();
        }
    }
    trimmed.to_string()
}

/// Parse Sentry Link header for next page cursor.
/// Format: `<url>; rel="next"; results="true"; cursor="..."`
fn parse_link_cursor(headers: &header::HeaderMap) -> Option<String> {
    let link = headers.get("link")?.to_str().ok()?;
    for part in link.split(',') {
        if part.contains(r#"rel="next""#) && part.contains(r#"results="true""#) {
            // Extract cursor="..." value
            for segment in part.split(';') {
                let segment = segment.trim();
                if let Some(val) = segment.strip_prefix("cursor=\"") {
                    return Some(val.trim_end_matches('"').to_string());
                }
            }
        }
    }
    None
}
