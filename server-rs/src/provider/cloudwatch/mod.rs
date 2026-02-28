pub mod aws_client;
pub mod investigator;
mod provider;

pub use provider::CloudWatchProvider;

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(CloudWatchProvider));
}
