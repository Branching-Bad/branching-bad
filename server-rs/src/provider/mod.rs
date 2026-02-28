pub mod jira;
pub mod sentry;

pub fn register_all(registry: &mut ProviderRegistry) {
    jira::register(registry);
    sentry::register(registry);
}

use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

/// Metadata that frontend uses to render provider UI
#[derive(Debug, Clone, Serialize)]
pub struct ProviderMeta {
    pub id: &'static str,
    pub display_name: &'static str,
    pub connect_fields: Vec<ConnectField>,
    pub resource_label: &'static str,
    pub has_items_panel: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectField {
    pub key: &'static str,
    pub label: &'static str,
    pub field_type: FieldType,
    pub required: bool,
    pub placeholder: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    Text,
    Password,
}

/// Result of validating credentials
pub struct ValidateResult {
    pub display_name: String,
    pub extra: Value,
}

/// A resource that can be bound to a repo (Jira Board, Sentry Project)
pub struct ProviderResource {
    pub external_id: String,
    pub name: String,
    pub extra: Value,
}

/// An item synced from the provider (Sentry Issue)
pub struct ProviderItem {
    pub external_id: String,
    pub title: String,
    pub data: Value,
}

/// Fields for creating a task from a provider item
pub struct TaskFieldsFromItem {
    pub title: String,
    pub description: Option<String>,
    pub require_plan: bool,
    pub auto_start: bool,
}

#[async_trait]
pub trait Provider: Send + Sync {
    fn meta(&self) -> ProviderMeta;

    /// Validate credentials from connect form. Returns org/user info.
    async fn validate_credentials(&self, config: &Value) -> Result<ValidateResult>;

    /// List resources (boards, projects) for binding to repos
    async fn list_resources(&self, config: &Value) -> Result<Vec<ProviderResource>>;

    /// Sync items from provider. Called by background worker.
    /// Returns items that should be upserted.
    async fn sync_items(
        &self,
        config: &Value,
        resource_id: &str,
        since: Option<&str>,
    ) -> Result<Vec<ProviderItem>>;

    /// Convert a provider item into task creation fields.
    fn item_to_task_fields(&self, item: &ProviderItem) -> TaskFieldsFromItem;

    /// Mask sensitive fields for API responses
    fn mask_account(&self, config: Value) -> Value;
}

pub struct ProviderRegistry {
    providers: Vec<(String, Box<dyn Provider>)>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: vec![],
        }
    }

    pub fn register(&mut self, provider: Box<dyn Provider>) {
        let id = provider.meta().id.to_string();
        self.providers.push((id, provider));
    }

    pub fn get(&self, id: &str) -> Option<&dyn Provider> {
        self.providers
            .iter()
            .find(|(pid, _)| pid == id)
            .map(|(_, p)| p.as_ref())
    }

    pub fn all(&self) -> Vec<&dyn Provider> {
        self.providers.iter().map(|(_, p)| p.as_ref()).collect()
    }

    pub fn all_metas(&self) -> Vec<ProviderMeta> {
        self.providers.iter().map(|(_, p)| p.meta()).collect()
    }
}
