import type { ComponentType } from "react";

export type NavActionProps = {
  selectedRepoId: string;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onTasksUpdated: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
};

export type ItemsPanelProps = {
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
  navBarAction?: ComponentType<NavActionProps>;
  itemsPanel?: ComponentType<ItemsPanelProps>;
  settingsTab?: ComponentType<SettingsTabProps>;
};
