import { registerProviderUI } from "../registry";
import { PgDrawerSection } from "./PgDrawerSection";
import { PgSettingsTab } from "./PgSettingsTab";

export function registerPostgresUI() {
  registerProviderUI("postgres", {
    drawerSection: PgDrawerSection,
    settingsTab: PgSettingsTab,
  });
}
