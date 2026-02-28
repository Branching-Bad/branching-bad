import type { ComponentType } from "react";

export type DrawerSectionProps = {
  selectedRepoId: string;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
};

export type SettingsTabProps = {
  selectedRepoId: string;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onBootstrapRefresh: () => void;
};

export type ProviderUI = {
  drawerSection: ComponentType<DrawerSectionProps>;
  settingsTab: ComponentType<SettingsTabProps>;
};
