use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use super::client::{SonarClient, issues_to_item_tuples, generate_token_basic_auth, change_password_basic_auth, create_project_basic_auth};
use super::docker::{self, ScanConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupJob {
    pub status: String,
    pub result: Option<SetupResult>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupResult {
    pub base_url: String,
    pub token: String,
}

pub fn sonarqube_routes() -> Router<AppState> {
    Router::new()
        .route("/api/sonarqube/scan", post(sq_start_scan))
        .route("/api/sonarqube/scans/{scan_id}", get(sq_get_scan))
        .route("/api/sonarqube/scans", get(sq_list_scans))
        .route("/api/sonarqube/docker-status", get(sq_docker_status))
        .route("/api/sonarqube/setup-local", post(sq_setup_local))
        .route("/api/sonarqube/setup-status/{job_id}", get(sq_setup_status))
        .route("/api/sonarqube/local-status", get(sq_local_status))
        .route("/api/sonarqube/quality-profiles", get(sq_quality_profiles))
        .route("/api/sonarqube/quality-gates", get(sq_quality_gates))
        .route("/api/sonarqube/scan-config", get(sq_get_scan_config).post(sq_save_scan_config))
}

async fn sq_docker_status() -> Json<Value> {
    let available = docker::check_docker_available().await.unwrap_or(false);
    Json(json!({ "available": available }))
}

async fn sq_local_status() -> Json<Value> {
    let docker_ok = docker::check_docker_available().await.unwrap_or(false);
    if !docker_ok {
        return Json(json!({ "container": "not_found", "ready": false }));
    }
    let status = docker::get_sonarqube_container_status().await;
    let (container_str, ready) = match status {
        docker::ContainerStatus::Running => ("running", true),
        docker::ContainerStatus::Exited => ("exited", false),
        docker::ContainerStatus::NotFound => ("not_found", false),
        docker::ContainerStatus::Other(ref s) => (s.as_str(), false),
    };
    Json(json!({ "container": container_str, "ready": ready }))
}

#[derive(Debug, Deserialize)]
struct SetupLocalPayload {
    port: Option<u16>,
    #[serde(rename = "adminUser")]
    admin_user: Option<String>,
    #[serde(rename = "adminPassword")]
    admin_password: Option<String>,
    #[serde(rename = "repoId")]
    repo_id: Option<String>,
}

async fn sq_setup_local(
    State(state): State<AppState>,
    Json(payload): Json<SetupLocalPayload>,
) -> Result<Json<Value>, ApiError> {
    let port = payload.port.unwrap_or(9000);
    let admin_user = payload.admin_user.unwrap_or_else(|| "admin".to_string());
    let admin_password = payload.admin_password.unwrap_or_else(|| "admin".to_string());
    let job_id = uuid::Uuid::new_v4().to_string();
    let base_url = format!("http://localhost:{}", port);

    // Resolve repo info before spawn (if provided)
    let repo_info = if let Some(ref repo_id) = payload.repo_id {
        state
            .db
            .get_repo_by_id(repo_id)
            .map_err(ApiError::internal)?
            .map(|r| (r.id, r.name))
    } else {
        None
    };

    {
        let mut jobs = state.setup_jobs.lock().await;
        jobs.insert(job_id.clone(), SetupJob {
            status: "starting".to_string(),
            result: None,
            error: None,
        });
    }

    let jobs = state.setup_jobs.clone();
    let db = state.db.clone();
    let jid = job_id.clone();

    tokio::spawn(async move {
        // Step 1: Check Docker
        let docker_ok = docker::check_docker_available().await.unwrap_or(false);
        if !docker_ok {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "failed".to_string();
                job.error = Some("Docker is not available".to_string());
            }
            return;
        }

        // Step 2: Start container
        if let Err(e) = docker::start_sonarqube_container(port).await {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "failed".to_string();
                job.error = Some(format!("Failed to start container: {}", e));
            }
            return;
        }

        {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "waiting".to_string();
            }
        }

        // Step 3: Wait for SonarQube to be ready
        if let Err(e) = docker::wait_for_sonarqube_ready(&base_url, 180).await {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "failed".to_string();
                job.error = Some(format!("SonarQube did not start: {}", e));
            }
            return;
        }

        {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "configuring".to_string();
            }
        }

        // Step 4: Change default password (skip if already changed)
        if admin_password != "admin" {
            let _ = change_password_basic_auth(&base_url, "admin", "admin", &admin_password).await;
        }

        // Step 5: Generate token
        let token_name = format!("idea-agent-{}", &jid[..8]);
        let token = match generate_token_basic_auth(&base_url, &admin_user, &admin_password, &token_name).await {
            Ok(t) => t,
            Err(e) => {
                let mut j = jobs.lock().await;
                if let Some(job) = j.get_mut(&jid) {
                    job.status = "failed".to_string();
                    job.error = Some(format!("Token generation failed: {}", e));
                }
                return;
            }
        };

        // Step 6: If repoId was provided, create project + account + resource + binding
        if let Some((repo_id, repo_name)) = &repo_info {
            // Sanitize repo name into a valid project key (lowercase, alphanumeric + hyphens)
            let project_key: String = repo_name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
                .collect();

            // Create project in SonarQube
            if let Err(e) = create_project_basic_auth(&base_url, &admin_user, &admin_password, &project_key, repo_name).await {
                let mut j = jobs.lock().await;
                if let Some(job) = j.get_mut(&jid) {
                    job.status = "failed".to_string();
                    job.error = Some(format!("Project creation failed: {}", e));
                }
                return;
            }

            // Upsert provider account (mode=local)
            let config = serde_json::json!({
                "base_url": base_url,
                "token": token,
                "mode": "local",
            });
            let display_name = format!("Local (localhost:{})", port);
            match db.upsert_provider_account("sonarqube", &config, &display_name) {
                Ok(account) => {
                    // Upsert resource
                    let resources = vec![(project_key.clone(), repo_name.clone(), "{}".to_string())];
                    let _ = db.upsert_provider_resources(&account.id, "sonarqube", &resources);

                    // Find the resource ID we just created
                    if let Ok(all_resources) = db.list_provider_resources(&account.id) {
                        if let Some(res) = all_resources.iter().find(|r| r.external_id == project_key) {
                            let _ = db.create_provider_binding(repo_id, &account.id, &res.id, "sonarqube", "{}");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Warning: failed to create local SQ account: {}", e);
                }
            }
        }

        // Mark completed
        {
            let mut j = jobs.lock().await;
            if let Some(job) = j.get_mut(&jid) {
                job.status = "completed".to_string();
                job.result = Some(SetupResult {
                    base_url: base_url.clone(),
                    token,
                });
            }
        }
    });

    Ok(Json(json!({ "jobId": job_id, "status": "starting" })))
}

async fn sq_setup_status(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let jobs = state.setup_jobs.lock().await;
    match jobs.get(&job_id) {
        Some(job) => Ok(Json(json!({
            "status": job.status,
            "result": job.result,
            "error": job.error,
        }))),
        None => Err(ApiError::not_found("Setup job not found")),
    }
}

// --- Quality & Scan Config endpoints ---

use crate::db::Db;

fn resolve_sonar_client(db: &Db, account_id: &str) -> Result<SonarClient, ApiError> {
    let account = db.get_provider_account(account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Account not found"))?;
    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let base_url = config["base_url"].as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("Account missing base_url"))?;
    let token = config["token"].as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("Account missing token"))?;
    Ok(SonarClient::new(base_url, token))
}

#[derive(Debug, Deserialize)]
struct SqAccountQuery {
    #[serde(rename = "accountId")]
    account_id: String,
}

async fn sq_quality_profiles(
    State(state): State<AppState>,
    Query(q): Query<SqAccountQuery>,
) -> Result<Json<Value>, ApiError> {
    let client = resolve_sonar_client(&state.db, &q.account_id)?;
    let profiles = client.list_quality_profiles().await.map_err(ApiError::internal)?;
    Ok(Json(json!({ "profiles": profiles })))
}

async fn sq_quality_gates(
    State(state): State<AppState>,
    Query(q): Query<SqAccountQuery>,
) -> Result<Json<Value>, ApiError> {
    let client = resolve_sonar_client(&state.db, &q.account_id)?;
    let gates = client.list_quality_gates().await.map_err(ApiError::internal)?;
    Ok(Json(json!({ "gates": gates })))
}

#[derive(Debug, Deserialize)]
struct SqScanConfigQuery {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "resourceId")]
    resource_id: String,
}

async fn sq_get_scan_config(
    State(state): State<AppState>,
    Query(q): Query<SqScanConfigQuery>,
) -> Result<Json<Value>, ApiError> {
    let config_json = state.db.get_binding_config(&q.repo_id, &q.account_id, &q.resource_id)
        .map_err(ApiError::internal)?;
    let scan_config: ScanConfig = config_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let defaults: Vec<String> = docker::DEFAULT_EXCLUSIONS.iter().map(|s| s.to_string()).collect();
    Ok(Json(json!({ "config": scan_config, "defaultExclusions": defaults })))
}

#[derive(Debug, Deserialize)]
struct SqSaveScanConfigPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "resourceId")]
    resource_id: String,
    config: ScanConfig,
    #[serde(rename = "qualityGateName")]
    quality_gate_name: Option<String>,
    #[serde(rename = "qualityProfileName")]
    quality_profile_name: Option<String>,
    #[serde(rename = "qualityProfileLanguage")]
    quality_profile_language: Option<String>,
}

async fn sq_save_scan_config(
    State(state): State<AppState>,
    Json(payload): Json<SqSaveScanConfigPayload>,
) -> Result<Json<Value>, ApiError> {
    let config_str = serde_json::to_string(&payload.config).map_err(|e| ApiError::internal(e.into()))?;
    state.db.update_binding_config(
        &payload.repo_id, &payload.account_id, &payload.resource_id, &config_str,
    ).map_err(ApiError::internal)?;

    // Apply quality settings to SonarQube project
    let has_gate = payload.quality_gate_name.is_some();
    let has_profile = payload.quality_profile_name.is_some() && payload.quality_profile_language.is_some();

    if has_gate || has_profile {
        let client = resolve_sonar_client(&state.db, &payload.account_id)?;
        if let Ok(Some(resource)) = state.db.get_provider_resource(&payload.resource_id) {
            if let Some(ref gate_name) = payload.quality_gate_name {
                client.set_quality_gate(&resource.external_id, gate_name).await.map_err(ApiError::internal)?;
            }
            if let (Some(ref profile_name), Some(ref lang)) = (&payload.quality_profile_name, &payload.quality_profile_language) {
                client.set_quality_profile(&resource.external_id, profile_name, lang).await.map_err(ApiError::internal)?;
            }
        }
    }

    Ok(Json(json!({ "saved": true })))
}

// --- Scan endpoints ---

#[derive(Debug, Deserialize)]
struct SqScanPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "projectKey")]
    project_key: String,
    #[serde(rename = "resourceId")]
    resource_id: Option<String>,
}

async fn sq_start_scan(
    State(state): State<AppState>,
    Json(payload): Json<SqScanPayload>,
) -> Result<Json<Value>, ApiError> {
    let scan_id = uuid::Uuid::new_v4().to_string();

    let repo = state
        .db
        .get_repo_by_id(&payload.repo_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Repo not found"))?;

    let account = state
        .db
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found"))?;
    let config: Value =
        serde_json::from_str(&account.config_json).unwrap_or(Value::Null);

    let base_url = config["base_url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("SonarQube base_url is missing from account config"))?
        .to_string();
    let token = config["token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("SonarQube token is missing from account config"))?
        .to_string();

    state
        .db
        .insert_sonar_scan(&scan_id, &payload.repo_id, &payload.account_id, &payload.project_key)
        .map_err(ApiError::internal)?;

    // Resolve resource_id before spawn: prefer payload, fallback to binding lookup
    let resource_id = match payload.resource_id {
        Some(ref rid) if !rid.is_empty() => Some(rid.clone()),
        _ => {
            state
                .db
                .list_provider_bindings_for_repo(&payload.repo_id)
                .ok()
                .and_then(|bindings| {
                    bindings
                        .iter()
                        .find(|b| b.provider_id == "sonarqube" && b.provider_account_id == payload.account_id)
                        .map(|b| b.provider_resource_id.clone())
                })
        }
    };

    // Load ScanConfig from binding config_json
    let scan_config: ScanConfig = resource_id
        .as_ref()
        .and_then(|rid| {
            state.db.get_binding_config(&payload.repo_id, &payload.account_id, rid).ok().flatten()
        })
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let db = state.db.clone();
    let sid = scan_id.clone();
    let repo_path = repo.path;
    let project_key = payload.project_key;
    let account_id = payload.account_id;

    tokio::spawn(async move {
        let scan_result = docker::run_scan(&repo_path, &project_key, &base_url, &token, &scan_config).await;

        match scan_result {
            Ok(_) => {
                let client = SonarClient::new(&base_url, &token);
                match client.search_issues(&project_key).await {
                    Ok(issues) => {
                        let issues_count = issues.len() as i64;

                        if let Some(res_id) = &resource_id {
                            let items = issues_to_item_tuples(&issues);
                            let _ = db.upsert_provider_items(
                                &account_id,
                                res_id,
                                "sonarqube",
                                &items,
                            );
                        }

                        let _ = db.update_sonar_scan_status(
                            &sid,
                            "completed",
                            Some(issues_count),
                            None,
                        );
                    }
                    Err(e) => {
                        let _ = db.update_sonar_scan_status(
                            &sid,
                            "failed",
                            None,
                            Some(&format!("Issue fetch failed: {}", e)),
                        );
                    }
                }
            }
            Err(e) => {
                let _ = db.update_sonar_scan_status(
                    &sid,
                    "failed",
                    None,
                    Some(&e.to_string()),
                );
            }
        }
    });

    Ok(Json(json!({ "id": scan_id, "status": "running" })))
}

async fn sq_get_scan(
    State(state): State<AppState>,
    Path(scan_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let scan = state
        .db
        .get_sonar_scan(&scan_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Scan not found"))?;
    Ok(Json(json!({ "scan": scan })))
}

#[derive(Debug, Deserialize)]
struct SqScansQuery {
    #[serde(rename = "repoId")]
    repo_id: String,
}

async fn sq_list_scans(
    State(state): State<AppState>,
    Query(q): Query<SqScansQuery>,
) -> Result<Json<Value>, ApiError> {
    let scans = state
        .db
        .list_sonar_scans_by_repo(&q.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "scans": scans })))
}
