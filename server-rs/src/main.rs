mod db;
mod discovery;
mod errors;
mod executor;
mod models;
mod msg_store;
mod planner;
mod process_manager;
mod provider;
mod routes;

use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use anyhow::Context;
use axum::Router;
use directories::ProjectDirs;
use tower_http::cors::{Any, CorsLayer};

use crate::{
    db::Db,
    process_manager::ProcessManager,
    provider::ProviderRegistry,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub process_manager: Arc<ProcessManager>,
    pub registry: Arc<ProviderRegistry>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_path = resolve_db_path()?;
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!("failed to create app data directory: {}", parent.display())
        })?;
    }
    let db = Arc::new(Db::new(db_path));
    db.init()?;

    ProcessManager::recover_orphans(&db);
    if let Err(error) = db.fail_stale_running_plan_jobs() {
        eprintln!("Warning: failed to recover stale plan jobs: {}", error);
    }
    if let Err(error) = db.reset_stale_plan_generating_tasks() {
        eprintln!("Warning: failed to reset stale PLAN_GENERATING tasks: {}", error);
    }
    if let Err(error) = db.requeue_stale_running_autostart_jobs() {
        eprintln!("Warning: failed to recover stale autostart jobs: {}", error);
    }

    let process_manager = ProcessManager::new();

    let mut registry = ProviderRegistry::new();
    provider::register_all(&mut registry);

    let state = AppState {
        db,
        process_manager,
        registry: Arc::new(registry),
    };
    routes::autostart::spawn_autostart_worker(state.clone());
    provider::routes::spawn_provider_sync_worker(state.clone());

    let app = Router::new()
        .merge(routes::health::health_routes())
        .merge(routes::repos::repo_routes())
        .merge(routes::tasks::task_routes())
        .merge(routes::plans::plan_routes())
        .merge(routes::runs::run_routes())
        .merge(routes::reviews::review_routes())
        .merge(routes::agents::agent_routes())
        .merge(routes::chat::chat_routes())
        .merge(routes::fs::fs_routes())
        .merge(provider::routes::provider_routes())
        .merge(provider::cloudwatch::routes::cloudwatch_routes())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);

    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(4310);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Rust local agent API running on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_db_path() -> anyhow::Result<PathBuf> {
    if let Ok(override_dir) = env::var("APP_DATA_DIR") {
        return Ok(PathBuf::from(override_dir).join("agent.db"));
    }
    let project_dirs = ProjectDirs::from("", "", "jira-approval-local-agent")
        .context("unable to resolve app data directory")?;
    Ok(project_dirs.data_dir().join("agent.db"))
}
