import type { ProviderUI } from "./types";

const registry = new Map<string, ProviderUI>();

export function registerProviderUI(id: string, ui: ProviderUI) {
  registry.set(id, ui);
}

export function getProviderUI(id: string) {
  return registry.get(id);
}

export function getAllProviderUIs() {
  return [...registry.entries()];
}
