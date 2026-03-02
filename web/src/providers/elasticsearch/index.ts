import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { EsDrawerSection } from "./EsDrawerSection";

export function registerElasticsearchUI() {
  registerProviderUI("elasticsearch", {
    drawerSection: EsDrawerSection,
    settingsTab: createProviderSettingsTab("elasticsearch"),
  });
}
