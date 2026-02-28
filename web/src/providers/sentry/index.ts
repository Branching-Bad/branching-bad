import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { SentryItemsPanel } from "./SentryItemsPanel";

export function registerSentryUI() {
  registerProviderUI("sentry", {
    itemsPanel: SentryItemsPanel,
    settingsTab: createProviderSettingsTab("sentry"),
  });
}
