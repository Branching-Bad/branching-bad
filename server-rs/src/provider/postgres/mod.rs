pub mod client;
mod provider;

pub use provider::PostgresProvider;

use crate::provider::ProviderRegistry;

pub fn register(registry: &mut ProviderRegistry) {
    registry.register(Box::new(PostgresProvider));
}
