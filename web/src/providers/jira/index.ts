import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { JiraSyncButton } from "./JiraSyncButton";

export function registerJiraUI() {
  registerProviderUI("jira", {
    navBarAction: JiraSyncButton,
    settingsTab: createProviderSettingsTab("jira"),
  });
}
