pub mod client;
pub mod docker;
mod provider;
pub mod routes;

pub use provider::SonarQubeProvider;

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(SonarQubeProvider));
}
