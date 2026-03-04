use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::Value;

pub struct EsClient {
    base_url: String,
    auth: EsAuth,
    http: reqwest::Client,
}

enum EsAuth {
    None,
    Basic { user: String, pass: String },
    ApiKey(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClusterHealth {
    pub cluster_name: String,
    pub status: String,
    pub number_of_nodes: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndexInfo {
    pub index: String,
    #[serde(default)]
    pub health: String,
    #[serde(default, rename = "docs.count")]
    pub docs_count: Option<String>,
    #[serde(default, rename = "store.size")]
    pub store_size: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub _total: u64,
    pub hits: Vec<Value>,
}

impl EsClient {
    pub fn from_config(config: &serde_json::Value) -> Self {
        let url = config["url"].as_str().unwrap_or_default();
        let username = config["username"].as_str();
        let password = config["password"].as_str();
        let api_key = config["api_key"].as_str();
        Self::new(url, username, password, api_key)
    }

    pub fn new(base_url: &str, username: Option<&str>, password: Option<&str>, api_key: Option<&str>) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();
        let auth = if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            EsAuth::ApiKey(key.to_string())
        } else if let Some(user) = username.filter(|u| !u.is_empty()) {
            EsAuth::Basic {
                user: user.to_string(),
                pass: password.unwrap_or_default().to_string(),
            }
        } else {
            EsAuth::None
        };
        Self {
            base_url,
            auth,
            http: reqwest::Client::new(),
        }
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth {
            EsAuth::None => req,
            EsAuth::Basic { user, pass } => req.basic_auth(user, Some(pass)),
            EsAuth::ApiKey(key) => req.header("Authorization", format!("ApiKey {}", key)),
        }
    }

    /// GET /_cluster/health — validate connection
    pub async fn cluster_health(&self) -> Result<ClusterHealth> {
        let url = format!("{}/_cluster/health", self.base_url);
        let resp = self.apply_auth(self.http.get(&url)).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("Cluster health failed ({}): {}", status, text));
        }
        let health: ClusterHealth = serde_json::from_str(&text)?;
        Ok(health)
    }

    /// GET /_cat/indices?format=json — list indices
    pub async fn list_indices(&self) -> Result<Vec<IndexInfo>> {
        let url = format!("{}/_cat/indices?format=json&h=index,health,docs.count,store.size", self.base_url);
        let resp = self.apply_auth(self.http.get(&url)).send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("List indices failed ({}): {}", status, text));
        }
        let mut indices: Vec<IndexInfo> = serde_json::from_str(&text)?;
        // Filter out system indices starting with '.'
        indices.retain(|i| !i.index.starts_with('.'));
        indices.sort_by(|a, b| a.index.cmp(&b.index));
        Ok(indices)
    }

    /// POST /{index}/_search — execute search query
    pub async fn search(&self, index: &str, query_json: &Value, size: u64) -> Result<SearchResult> {
        let url = format!("{}/{}/_search", self.base_url, index);
        let body = serde_json::json!({
            "query": query_json,
            "size": size,
            "sort": [{ "@timestamp": { "order": "desc" } }],
        });

        let resp = self.apply_auth(
            self.http.post(&url)
                .header("Content-Type", "application/json")
                .body(serde_json::to_vec(&body)?)
        ).send().await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(anyhow!("ES search failed ({}): {}", status, text));
        }

        let parsed: Value = serde_json::from_str(&text)?;
        let total = parsed["hits"]["total"]["value"]
            .as_u64()
            .or_else(|| parsed["hits"]["total"].as_u64())
            .unwrap_or(0);

        let hits = parsed["hits"]["hits"]
            .as_array()
            .map(|arr| arr.to_vec())
            .unwrap_or_default();

        Ok(SearchResult { _total: total, hits })
    }
}
