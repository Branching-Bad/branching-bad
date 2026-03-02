pub mod es_client;
pub mod investigator;
mod provider;
pub mod routes;

pub use provider::ElasticsearchProvider;

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(ElasticsearchProvider));
}
