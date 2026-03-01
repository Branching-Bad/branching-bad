use anyhow::{Context, Result, anyhow};
use reqwest::{Client, header};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqProject {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqIssue {
    pub key: String,
    pub rule: String,
    pub severity: String,
    pub message: String,
    pub component: String,
    pub line: Option<i64>,
    #[serde(rename = "type")]
    pub type_field: String,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqQualityProfile {
    pub key: String,
    pub name: String,
    pub language: String,
    #[serde(rename = "languageName", default)]
    pub language_name: String,
    #[serde(rename = "isDefault", default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqQualityGate {
    pub id: String,
    pub name: String,
    #[serde(rename = "isDefault", default)]
    pub is_default: bool,
    #[serde(rename = "isBuiltIn", default)]
    pub is_built_in: bool,
}

pub struct SonarClient {
    client: Client,
    base_url: String,
    token: String,
}

impl SonarClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
        }
    }

    async fn get_json(&self, endpoint: &str, query: &[(&str, &str)]) -> Result<Value> {
        let url = format!("{}{}", self.base_url, endpoint);
        let mut req = self
            .client
            .get(&url)
            .header(header::ACCEPT, "application/json")
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token));
        if !query.is_empty() {
            req = req.query(query);
        }

        let resp = req
            .send()
            .await
            .with_context(|| format!("SonarQube request failed: {endpoint}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!(
                "SonarQube request failed ({status}): {}",
                body.chars().take(300).collect::<String>()
            ));
        }

        resp.json::<Value>()
            .await
            .context("SonarQube response decode failed")
    }

    /// Validate connection by calling GET /api/system/status
    pub async fn validate(&self) -> Result<String> {
        let body = self.get_json("/api/system/status", &[]).await?;
        let status = body["status"].as_str().unwrap_or("UNKNOWN");
        if status != "UP" {
            return Err(anyhow!("SonarQube server status is '{status}', expected 'UP'"));
        }
        Ok(format!("SonarQube ({})", self.base_url))
    }

    /// List projects via GET /api/projects/search
    pub async fn list_projects(&self) -> Result<Vec<SqProject>> {
        let mut all = Vec::new();
        let mut page = 1u64;

        loop {
            let page_str = page.to_string();
            let body = self
                .get_json("/api/projects/search", &[("ps", "500"), ("p", &page_str)])
                .await?;

            let components = body["components"].as_array();
            match components {
                Some(items) if !items.is_empty() => {
                    for item in items {
                        let key = item["key"].as_str().unwrap_or_default().to_string();
                        let name = item["name"].as_str().unwrap_or(&key).to_string();
                        if !key.is_empty() {
                            all.push(SqProject { key, name });
                        }
                    }
                    let total = body["paging"]["total"].as_i64().unwrap_or(0) as u64;
                    if (page * 500) >= total {
                        break;
                    }
                    page += 1;
                }
                _ => break,
            }
        }

        Ok(all)
    }

    /// Search issues via GET /api/issues/search
    pub async fn search_issues(&self, project_key: &str) -> Result<Vec<SqIssue>> {
        let body = self
            .get_json(
                "/api/issues/search",
                &[
                    ("componentKeys", project_key),
                    ("resolved", "false"),
                    ("ps", "500"),
                    ("statuses", "OPEN,CONFIRMED,REOPENED"),
                ],
            )
            .await?;

        let empty = vec![];
        let issues = body["issues"].as_array().unwrap_or(&empty);

        let mut result = Vec::new();
        for issue in issues {
            let key = issue["key"].as_str().unwrap_or_default().to_string();
            if key.is_empty() {
                continue;
            }
            result.push(SqIssue {
                key,
                rule: issue["rule"].as_str().unwrap_or_default().to_string(),
                severity: issue["severity"].as_str().unwrap_or("MAJOR").to_string(),
                message: issue["message"].as_str().unwrap_or_default().to_string(),
                component: issue["component"].as_str().unwrap_or_default().to_string(),
                line: issue["line"].as_i64(),
                type_field: issue["type"].as_str().unwrap_or("CODE_SMELL").to_string(),
                effort: issue["effort"].as_str().map(str::to_string),
            });
        }

        Ok(result)
    }

    async fn post_form(&self, endpoint: &str, params: &[(&str, &str)]) -> Result<()> {
        let url = format!("{}{}", self.base_url, endpoint);
        let resp = self
            .client
            .post(&url)
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token))
            .form(params)
            .send()
            .await
            .with_context(|| format!("SonarQube POST failed: {endpoint}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!(
                "SonarQube POST failed ({status}): {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        Ok(())
    }

    /// List quality profiles via GET /api/qualityprofiles/search
    pub async fn list_quality_profiles(&self) -> Result<Vec<SqQualityProfile>> {
        let body = self.get_json("/api/qualityprofiles/search", &[]).await?;
        let empty = vec![];
        let profiles = body["profiles"].as_array().unwrap_or(&empty);
        let mut result = Vec::new();
        for p in profiles {
            let key = p["key"].as_str().unwrap_or_default().to_string();
            if key.is_empty() { continue; }
            result.push(SqQualityProfile {
                key,
                name: p["name"].as_str().unwrap_or_default().to_string(),
                language: p["language"].as_str().unwrap_or_default().to_string(),
                language_name: p["languageName"].as_str().unwrap_or_default().to_string(),
                is_default: p["isDefault"].as_bool().unwrap_or(false),
            });
        }
        Ok(result)
    }

    /// List quality gates via GET /api/qualitygates/list
    pub async fn list_quality_gates(&self) -> Result<Vec<SqQualityGate>> {
        let body = self.get_json("/api/qualitygates/list", &[]).await?;
        let empty = vec![];
        let gates = body["qualitygates"].as_array().unwrap_or(&empty);
        let mut result = Vec::new();
        for g in gates {
            let id = g["id"].as_i64().map(|i| i.to_string())
                .or_else(|| g["id"].as_str().map(str::to_string))
                .unwrap_or_default();
            if id.is_empty() { continue; }
            result.push(SqQualityGate {
                id,
                name: g["name"].as_str().unwrap_or_default().to_string(),
                is_default: g["isDefault"].as_bool().unwrap_or(false),
                is_built_in: g["isBuiltIn"].as_bool().unwrap_or(false),
            });
        }
        Ok(result)
    }

    /// Set quality gate for a project via POST /api/qualitygates/select
    pub async fn set_quality_gate(&self, project_key: &str, gate_name: &str) -> Result<()> {
        self.post_form("/api/qualitygates/select", &[
            ("projectKey", project_key),
            ("gateName", gate_name),
        ]).await
    }

    /// Set quality profile for a project via POST /api/qualityprofiles/add_project
    pub async fn set_quality_profile(&self, project_key: &str, profile_name: &str, language: &str) -> Result<()> {
        self.post_form("/api/qualityprofiles/add_project", &[
            ("project", project_key),
            ("qualityProfile", profile_name),
            ("language", language),
        ]).await
    }
}

/// Create a project in SonarQube using basic auth
pub async fn create_project_basic_auth(
    base_url: &str,
    user: &str,
    pass: &str,
    project_key: &str,
    project_name: &str,
) -> Result<()> {
    let client = Client::new();
    let url = format!("{}/api/projects/create", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .basic_auth(user, Some(pass))
        .form(&[("project", project_key), ("name", project_name)])
        .send()
        .await
        .context("Failed to create SonarQube project")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // 400 with "already exists" is fine — project was previously created
        if status.as_u16() == 400 && body.contains("already exist") {
            return Ok(());
        }
        return Err(anyhow!("Project creation failed ({status}): {}", body.chars().take(300).collect::<String>()));
    }

    Ok(())
}

/// Generate an analysis token using basic auth (for first-time setup before bearer token exists)
pub async fn generate_token_basic_auth(
    base_url: &str,
    user: &str,
    pass: &str,
    token_name: &str,
) -> Result<String> {
    let client = Client::new();
    let url = format!("{}/api/user_tokens/generate", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .basic_auth(user, Some(pass))
        .form(&[("name", token_name), ("type", "USER_TOKEN")])
        .send()
        .await
        .context("Failed to generate SonarQube token")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Token generation failed ({status}): {}", body.chars().take(300).collect::<String>()));
    }

    let body: Value = resp.json().await.context("Token response decode failed")?;
    body["token"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Token field missing from response"))
}

/// Change admin password using basic auth (for first-time setup)
pub async fn change_password_basic_auth(
    base_url: &str,
    user: &str,
    old_pass: &str,
    new_pass: &str,
) -> Result<()> {
    let client = Client::new();
    let url = format!("{}/api/users/change_password", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .basic_auth(user, Some(old_pass))
        .form(&[("login", user), ("previousPassword", old_pass), ("password", new_pass)])
        .send()
        .await
        .context("Failed to change SonarQube password")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("Password change failed ({status}): {}", body.chars().take(300).collect::<String>()));
    }

    Ok(())
}

/// Convert SqIssues to the (external_id, title, data_json) tuples for upsert_provider_items
pub fn issues_to_item_tuples(issues: &[SqIssue]) -> Vec<(String, String, String)> {
    issues
        .iter()
        .map(|issue| {
            let title = format!("[{}] {}", issue.severity, issue.message);
            let data = serde_json::json!({
                "key": issue.key,
                "rule": issue.rule,
                "severity": issue.severity,
                "message": issue.message,
                "component": issue.component,
                "line": issue.line,
                "type": issue.type_field,
                "effort": issue.effort,
            });
            (
                issue.key.clone(),
                title,
                serde_json::to_string(&data).unwrap_or_default(),
            )
        })
        .collect()
}
