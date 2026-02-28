import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { JiraDrawerSection } from "./JiraDrawerSection";

export function registerJiraUI() {
  registerProviderUI("jira", {
    drawerSection: JiraDrawerSection,
    settingsTab: createProviderSettingsTab("jira"),
  });
}
