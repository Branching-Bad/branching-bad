import { registerCloudWatchUI } from "./cloudwatch";
import { registerJiraUI } from "./jira";
import { registerPostgresUI } from "./postgres";
import { registerSentryUI } from "./sentry";
import { registerSonarQubeUI } from "./sonarqube";

// Call this once at app startup to register all provider UIs.
// To add a new provider: create providers/<name>/ folder, implement the component,
// add registerXxxUI() here. No changes needed in App.tsx or ProviderItemsPanel.
export function initProviders() {
  registerJiraUI();
  registerSentryUI();
  registerPostgresUI();
  registerCloudWatchUI();
  registerSonarQubeUI();
}
