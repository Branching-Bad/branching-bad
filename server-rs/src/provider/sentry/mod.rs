pub mod client;
pub mod models;
mod provider;

pub use provider::SentryProvider;

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(SentryProvider));
}
