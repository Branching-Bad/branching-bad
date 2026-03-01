use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

use crate::AppState;
use crate::errors::ApiError;

pub(crate) fn health_routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/bootstrap", get(bootstrap))
}

async fn health(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
      "ok": true,
      "dbPath": state.db.db_path_string()
    })))
}

async fn bootstrap(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let repos = state.db.list_repos().map_err(ApiError::internal)?;
    let agent_profiles = state.db.list_agent_profiles().map_err(ApiError::internal)?;

    let provider_metas = state.registry.all_metas();
    let mut provider_accounts: serde_json::Map<String, Value> = serde_json::Map::new();
    for meta in &provider_metas {
        let accounts = state
            .db
            .list_provider_accounts(meta.id)
            .map_err(ApiError::internal)?;
        let provider = state.registry.get(meta.id);
        let masked: Vec<Value> = accounts
            .into_iter()
            .map(|a| {
                let config: Value =
                    serde_json::from_str(&a.config_json).unwrap_or(Value::Null);
                let masked_config = provider
                    .map(|p| p.mask_account(config.clone()))
                    .unwrap_or(config);
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
        provider_accounts.insert(meta.id.to_string(), json!(masked));
    }

    let provider_item_counts = state
        .db
        .count_all_pending_provider_items()
        .map_err(ApiError::internal)?;

    Ok(Json(json!({
      "repos": repos,
      "agentProfiles": agent_profiles,
      "providers": provider_metas,
      "providerAccounts": provider_accounts,
      "providerItemCounts": provider_item_counts
    })))
}
