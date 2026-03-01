import { registerProviderUI } from "../registry";
import { SqDrawerSection } from "./SqDrawerSection";
import { SqSettingsTab } from "./SqSettingsTab";

export function registerSonarQubeUI() {
  registerProviderUI("sonarqube", {
    drawerSection: SqDrawerSection,
    settingsTab: SqSettingsTab,
  });
}
