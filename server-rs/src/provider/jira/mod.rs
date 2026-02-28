pub mod client;
pub mod models;
mod provider;

pub use client::JiraClient;
pub use models::JiraIssueForTask;
pub use provider::JiraProvider;

// JiraMe is used internally by client/provider only

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(JiraProvider));
}
