import { registerProviderUI } from "../registry";
import { JiraDrawerSection } from "./JiraDrawerSection";
import { JiraSettingsTab } from "./JiraSettingsTab";

export function registerJiraUI() {
  registerProviderUI("jira", {
    drawerSection: JiraDrawerSection,
    settingsTab: JiraSettingsTab,
  });
}
