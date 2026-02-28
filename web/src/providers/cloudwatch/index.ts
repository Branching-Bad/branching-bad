import { registerProviderUI } from "../registry";
import { createProviderSettingsTab } from "../ProviderTab";
import { CwDrawerSection } from "./CwDrawerSection";

export function registerCloudWatchUI() {
  registerProviderUI("cloudwatch", {
    drawerSection: CwDrawerSection,
    settingsTab: createProviderSettingsTab("cloudwatch"),
  });
}
