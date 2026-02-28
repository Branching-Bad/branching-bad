import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { SentryDrawerSection } from "./SentryDrawerSection";

export function registerSentryUI() {
  registerProviderUI("sentry", {
    drawerSection: SentryDrawerSection,
    settingsTab: createProviderSettingsTab("sentry"),
  });
}
