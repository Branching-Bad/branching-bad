use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;
use crate::models::CreateTaskPayload;
use crate::msg_store::MsgStore;
use crate::routes::shared::{RepoQuery, plan_store_key, resolve_agent_command};
use crate::routes::plans::spawn_plan_generation_job;

pub(crate) fn provider_routes() -> Router<AppState> {
    Router::new()
        .route("/api/providers", get(list_providers))
        .route("/api/providers/{provider_id}/connect", post(provider_connect))
        .route("/api/providers/{provider_id}/accounts", get(provider_list_accounts))
        .route(
            "/api/providers/{provider_id}/accounts/{id}",
            axum::routing::delete(provider_delete_account),
        )
        .route(
            "/api/providers/{provider_id}/accounts/{id}/resources",
            get(provider_list_resources),
        )
        .route("/api/providers/{provider_id}/bind", post(provider_bind))
        .route("/api/providers/{provider_id}/bindings", get(provider_list_bindings))
        .route("/api/providers/{provider_id}/items/{repo_id}", get(provider_list_items))
        .route(
            "/api/providers/{provider_id}/items/{id}/action",
            post(provider_item_action),
        )
        .route(
            "/api/providers/{provider_id}/items/clear/{repo_id}",
            post(provider_clear_items),
        )
        .route(
            "/api/providers/{provider_id}/items/{id}/event",
            get(provider_item_event),
        )
        .route(
            "/api/providers/{provider_id}/items/{id}/create-task",
            post(provider_create_task_from_item),
        )
        .route(
            "/api/providers/{provider_id}/sync/{repo_id}",
            post(provider_manual_sync),
        )
}

#[derive(Debug, Deserialize)]
struct ProviderPath {
    provider_id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderAccountPath {
    provider_id: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderItemPath {
    provider_id: String,
    id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderRepoPath {
    provider_id: String,
    repo_id: String,
}

#[derive(Debug, Deserialize)]
struct ProviderItemQuery {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProviderBindPayload {
    #[serde(rename = "repoId")]
    repo_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "resourceId")]
    resource_id: String,
    config: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ProviderItemActionPayload {
    action: String,
}

async fn list_providers(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let metas = state.registry.all_metas();
    Ok(Json(json!({ "providers": metas })))
}

async fn provider_connect(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let result = provider
        .validate_credentials(&payload)
        .await
        .map_err(ApiError::bad_request_from)?;

    let account = state
        .db
        .upsert_provider_account(&path.provider_id, &payload, &result.display_name)
        .map_err(ApiError::internal)?;

    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let masked_config = provider.mask_account(config);

    Ok(Json(json!({
        "account": {
            "id": account.id,
            "providerId": account.provider_id,
            "displayName": account.display_name,
            "config": masked_config,
        },
        "extra": result.extra,
    })))
}

async fn provider_list_accounts(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let accounts = state
        .db
        .list_provider_accounts(&path.provider_id)
        .map_err(ApiError::internal)?;

    let masked: Vec<Value> = accounts
        .into_iter()
        .map(|a| {
            let config: Value = serde_json::from_str(&a.config_json).unwrap_or(Value::Null);
            let masked_config = provider.mask_account(config);
            json!({
                "id": a.id,
                "providerId": a.provider_id,
                "displayName": a.display_name,
                "config": masked_config,
                "createdAt": a.created_at,
                "updatedAt": a.updated_at,
            })
        })
        .collect();

    Ok(Json(json!({ "accounts": masked })))
}

async fn provider_delete_account(
    State(state): State<AppState>,
    Path(path): Path<ProviderAccountPath>,
) -> Result<Json<Value>, ApiError> {
    let _provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    state
        .db
        .delete_provider_account(&path.id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": true })))
}

async fn provider_list_resources(
    State(state): State<AppState>,
    Path(path): Path<ProviderAccountPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let account = state
        .db
        .get_provider_account(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Account not found."))?;

    let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
    let resources = provider
        .list_resources(&config)
        .await
        .map_err(ApiError::bad_request_from)?;

    let tuples: Vec<(String, String, String)> = resources
        .iter()
        .map(|r| (r.external_id.clone(), r.name.clone(), r.extra.to_string()))
        .collect();
    state
        .db
        .upsert_provider_resources(&account.id, &path.provider_id, &tuples)
        .map_err(ApiError::internal)?;

    let local_resources = state
        .db
        .list_provider_resources(&account.id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "resources": local_resources })))
}

async fn provider_bind(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Json(payload): Json<ProviderBindPayload>,
) -> Result<Json<Value>, ApiError> {
    if state
        .db
        .get_repo_by_id(&payload.repo_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Repo not found."));
    }
    if state
        .db
        .get_provider_account(&payload.account_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Account not found."));
    }
    if state
        .db
        .get_provider_resource(&payload.resource_id)
        .map_err(ApiError::internal)?
        .is_none()
    {
        return Err(ApiError::not_found("Resource not found."));
    }

    let config_json = payload
        .config
        .as_ref()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "{}".to_string());

    let binding = state
        .db
        .create_provider_binding(
            &payload.repo_id,
            &payload.account_id,
            &payload.resource_id,
            &path.provider_id,
            &config_json,
        )
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "binding": binding })))
}

async fn provider_list_bindings(
    State(state): State<AppState>,
    Path(path): Path<ProviderPath>,
    Query(query): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    let all = state
        .db
        .list_provider_bindings_for_repo(&query.repo_id)
        .map_err(ApiError::internal)?;
    let filtered: Vec<_> = all
        .into_iter()
        .filter(|b| b.provider_id == path.provider_id)
        .collect();

    let mut stored_resources = Vec::new();
    for b in &filtered {
        let resources = state
            .db
            .list_provider_resources(&b.provider_account_id)
            .unwrap_or_default();
        for r in resources {
            stored_resources.push(json!({
                "id": r.id,
                "provider_account_id": r.provider_account_id,
                "provider_id": r.provider_id,
                "external_id": r.external_id,
                "name": r.name,
                "extra_json": r.extra_json,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }));
        }
    }

    Ok(Json(
        json!({ "bindings": filtered, "resources": stored_resources }),
    ))
}

async fn provider_list_items(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
    Query(query): Query<ProviderItemQuery>,
) -> Result<Json<Value>, ApiError> {
    let items = state
        .db
        .list_provider_items(&path.repo_id, &path.provider_id, query.status.as_deref())
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "items": items })))
}

async fn provider_item_action(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
    Json(payload): Json<ProviderItemActionPayload>,
) -> Result<Json<Value>, ApiError> {
    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    match payload.action.as_str() {
        "ignore" => {
            state
                .db
                .update_provider_item_status(&item.id, "ignored")
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "ignored" })))
        }
        "restore" => {
            state
                .db
                .update_provider_item_status(&item.id, "pending")
                .map_err(ApiError::internal)?;
            Ok(Json(json!({ "status": "pending" })))
        }
        _ => Err(ApiError::bad_request(
            "Unsupported action. Use 'ignore' or 'restore'.",
        )),
    }
}

async fn provider_clear_items(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
) -> Result<Json<Value>, ApiError> {
    let deleted = state
        .db
        .delete_provider_items_for_repo(&path.provider_id, &path.repo_id)
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": deleted })))
}

async fn provider_item_event(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
) -> Result<Json<Value>, ApiError> {
    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    let account = state
        .db
        .get_provider_account(&item.provider_account_id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Provider account not found."))?;

    let config: serde_json::Value =
        serde_json::from_str(&account.config_json).unwrap_or_default();
    let base_url = config["base_url"].as_str().unwrap_or_default();
    let org_slug = config["org_slug"].as_str().unwrap_or_default();
    let auth_token = config["auth_token"].as_str().unwrap_or_default();

    let client =
        crate::provider::sentry::client::SentryClient::new(base_url, org_slug, auth_token);
    let event = client
        .fetch_latest_event(&item.external_id)
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(json!({ "event": event })))
}

async fn provider_create_task_from_item(
    State(state): State<AppState>,
    Path(path): Path<ProviderItemPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    let item = state
        .db
        .get_provider_item(&path.id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("Item not found."))?;

    if item.linked_task_id.is_some() && item.status != "regression" {
        return Err(ApiError::bad_request(
            "This item already has a linked task.",
        ));
    }

    let bindings = state
        .db
        .list_provider_bindings(&path.provider_id)
        .map_err(ApiError::internal)?;
    let binding = bindings
        .iter()
        .find(|b| {
            b.provider_account_id == item.provider_account_id
                && b.provider_resource_id == item.provider_resource_id
        })
        .ok_or_else(|| ApiError::bad_request("No repo binding found for this item."))?;

    let data: Value = serde_json::from_str(&item.data_json).unwrap_or(Value::Null);
    let provider_item = crate::provider::ProviderItem {
        external_id: item.external_id.clone(),
        title: item.title.clone(),
        data: data.clone(),
    };

    let fields = provider.item_to_task_fields(&provider_item);

    let task_payload = CreateTaskPayload {
        repo_id: binding.repo_id.clone(),
        title: fields.title,
        description: fields.description,
        status: Some("To Do".to_string()),
        priority: Some("High".to_string()),
        require_plan: Some(fields.require_plan),
        auto_start: Some(fields.auto_start),
        auto_approve_plan: Some(false),
        use_worktree: Some(true),
        agent_profile_id: None,
    };

    let task = state
        .db
        .create_manual_task(&task_payload)
        .map_err(ApiError::internal)?;

    state
        .db
        .link_provider_item_to_task(&item.id, &task.id)
        .map_err(ApiError::internal)?;

    if let Some(agent_command) = resolve_agent_command(&state, &binding.repo_id) {
        if let Ok(Some(repo)) = state.db.get_repo_by_id(&binding.repo_id) {
            let mode = format!("auto_{}", path.provider_id);
            if let Ok(job) = state.db.create_plan_job(&task.id, &mode, None) {
                let store = MsgStore::new();
                state
                    .process_manager
                    .register_store(&plan_store_key(&job.id), store.clone())
                    .await;
                spawn_plan_generation_job(
                    state.clone(),
                    job,
                    task.clone(),
                    repo.path.clone(),
                    agent_command,
                    &mode,
                    store,
                    None,
                );
            }
        }
    }

    Ok(Json(json!({ "task": task, "itemId": item.id })))
}

async fn provider_manual_sync(
    State(state): State<AppState>,
    Path(path): Path<ProviderRepoPath>,
) -> Result<Json<Value>, ApiError> {
    let provider = state
        .registry
        .get(&path.provider_id)
        .ok_or_else(|| ApiError::not_found("Provider not found."))?;

    if !provider.meta().has_items_panel {
        return Err(ApiError::bad_request(
            "This provider does not support item sync.",
        ));
    }

    let bindings = state
        .db
        .list_provider_bindings_for_repo(&path.repo_id)
        .map_err(ApiError::internal)?;
    let bindings: Vec<_> = bindings
        .into_iter()
        .filter(|b| b.provider_id == path.provider_id)
        .collect();
    if bindings.is_empty() {
        return Err(ApiError::bad_request(
            "No bindings for this provider and repo.",
        ));
    }

    let mut total_synced = 0usize;
    let mut sync_errors = Vec::new();
    for binding in &bindings {
        let account = match state.db.get_provider_account(&binding.provider_account_id) {
            Ok(Some(a)) => a,
            Ok(None) => {
                sync_errors.push(format!(
                    "Account {} not found",
                    binding.provider_account_id
                ));
                continue;
            }
            Err(e) => {
                sync_errors.push(format!("Account load error: {e}"));
                continue;
            }
        };
        let resource = match state.db.get_provider_resource(&binding.provider_resource_id) {
            Ok(Some(r)) => r,
            Ok(None) => {
                sync_errors.push(format!(
                    "Resource {} not found",
                    binding.provider_resource_id
                ));
                continue;
            }
            Err(e) => {
                sync_errors.push(format!("Resource load error: {e}"));
                continue;
            }
        };

        let config: Value = serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
        let since = state
            .db
            .get_last_provider_sync_time(&account.id, &resource.id)
            .ok().flatten();

        let items = match provider
            .sync_items(&config, &resource.external_id, since.as_deref())
            .await
        {
            Ok(items) => items,
            Err(e) => {
                sync_errors.push(format!("Sync {} failed: {e}", resource.external_id));
                continue;
            }
        };

        if !items.is_empty() {
            let tuples: Vec<(String, String, String)> = items
                .iter()
                .map(|i| (i.external_id.clone(), i.title.clone(), i.data.to_string()))
                .collect();
            match state.db.upsert_provider_items(
                &account.id,
                &resource.id,
                &path.provider_id,
                &tuples,
            ) {
                Ok(count) => total_synced += count,
                Err(e) => sync_errors.push(format!("DB upsert error: {e}")),
            }
        }
    }

    let items = state
        .db
        .list_provider_items(&path.repo_id, &path.provider_id, None)
        .map_err(ApiError::internal)?;
    let mut resp = json!({ "synced": total_synced, "items": items });
    if !sync_errors.is_empty() {
        resp["errors"] = json!(sync_errors);
    }
    Ok(Json(resp))
}

// ── Generic Provider Sync Worker ──

pub(crate) fn spawn_provider_sync_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;

            for provider in state.registry.all() {
                if !provider.meta().has_items_panel || !provider.auto_sync() {
                    continue;
                }

                let bindings = match state.db.list_provider_bindings(provider.meta().id) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!(
                            "Provider sync worker: failed to list bindings for {}: {e}",
                            provider.meta().id
                        );
                        continue;
                    }
                };

                for binding in &bindings {
                    let account =
                        match state.db.get_provider_account(&binding.provider_account_id) {
                            Ok(Some(a)) => a,
                            _ => continue,
                        };
                    let resource =
                        match state.db.get_provider_resource(&binding.provider_resource_id) {
                            Ok(Some(r)) => r,
                            _ => continue,
                        };

                    let config: Value =
                        serde_json::from_str(&account.config_json).unwrap_or(Value::Null);
                    let since = state
                        .db
                        .get_last_provider_sync_time(&account.id, &resource.id)
                        .ok().flatten();

                    let items = match provider
                        .sync_items(&config, &resource.external_id, since.as_deref())
                        .await
                    {
                        Ok(items) => items,
                        Err(e) => {
                            eprintln!(
                                "Provider sync worker: fetch error for {} / {}: {e}",
                                provider.meta().id,
                                resource.external_id
                            );
                            continue;
                        }
                    };

                    if !items.is_empty() {
                        let tuples: Vec<(String, String, String)> = items
                            .iter()
                            .map(|i| {
                                (i.external_id.clone(), i.title.clone(), i.data.to_string())
                            })
                            .collect();
                        if let Err(e) = state.db.upsert_provider_items(
                            &account.id,
                            &resource.id,
                            provider.meta().id,
                            &tuples,
                        ) {
                            eprintln!(
                                "Provider sync worker: upsert error for {} / {}: {e}",
                                provider.meta().id,
                                resource.external_id
                            );
                        }
                    }
                }
            }
        }
    });
}
