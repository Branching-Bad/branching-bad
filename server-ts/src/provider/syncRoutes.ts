// ---------------------------------------------------------------------------
// Generic Provider Sync Worker
// ---------------------------------------------------------------------------

import type { AppState } from '../state.js';
import type { ProviderItem } from './index.js';

const SYNC_INTERVAL_MS = 300_000; // 5 minutes

export function spawnProviderSyncWorker(state: AppState): void {
  setInterval(async () => {
    for (const provider of state.registry.all()) {
      if (!provider.meta().hasItemsPanel || !provider.autoSync()) {
        continue;
      }

      let bindings;
      try {
        bindings = state.db.listProviderBindings(provider.meta().id);
      } catch (e) {
        console.error(
          `Provider sync worker: failed to list bindings for ${provider.meta().id}: ${e}`,
        );
        continue;
      }

      for (const binding of bindings) {
        const account = state.db.getProviderAccount(binding.provider_account_id);
        if (!account) continue;

        const resource = state.db.getProviderResource(binding.provider_resource_id);
        if (!resource) continue;

        const config = JSON.parse(account.config_json);
        const since = state.db.getLastProviderSyncTime(account.id, resource.id);

        let items: ProviderItem[];
        try {
          items = await provider.syncItems(config, resource.external_id, since);
        } catch (e) {
          console.error(
            `Provider sync worker: fetch error for ${provider.meta().id} / ${resource.external_id}: ${e}`,
          );
          continue;
        }

        if (items.length > 0) {
          const tuples: Array<[string, string, string]> = items.map((i) => [
            i.externalId, i.title, JSON.stringify(i.data),
          ]);
          try {
            state.db.upsertProviderItems(
              account.id, resource.id, provider.meta().id, tuples,
            );
          } catch (e) {
            console.error(
              `Provider sync worker: upsert error for ${provider.meta().id} / ${resource.external_id}: ${e}`,
            );
          }
        }
      }
    }
  }, SYNC_INTERVAL_MS);
}
