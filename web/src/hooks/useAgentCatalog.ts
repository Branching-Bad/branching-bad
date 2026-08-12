import { useEffect, useState } from "react";
import { api } from "../api";

export type ModelTier = "low" | "medium" | "high";

export type CatalogModel = {
  id: string;
  name: string;
  description: string;
  tier?: ModelTier;
};

export type CanonicalEffort = "minimal" | "low" | "medium" | "high" | "max";

export type EffortCapability =
  | { supported: false }
  | {
      supported: true;
      default: CanonicalEffort;
      arg_template: string;
      canonical_to_native: Record<CanonicalEffort, string>;
    };

export type CatalogProvider = {
  id: string;
  name: string;
  binary: string;
  model_flag: string;
  effort?: EffortCapability;
  models: CatalogModel[];
};

export type AgentCatalog = { providers: CatalogProvider[] };

let cachedCatalog: AgentCatalog | null = null;
let inflight: Promise<AgentCatalog> | null = null;

export function useAgentCatalog(): {
  catalog: AgentCatalog | null;
  modelIdsForProvider: (providerId: string | null | undefined) => string[];
  providerById: (providerId: string | null | undefined) => CatalogProvider | null;
} {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(cachedCatalog);

  useEffect(() => {
    if (cachedCatalog) {
      setCatalog(cachedCatalog);
      return;
    }
    if (!inflight) {
      inflight = api<AgentCatalog>("/api/agents/catalog").then((data) => {
        cachedCatalog = data;
        return data;
      });
    }
    inflight.then((data) => setCatalog(data)).catch(() => setCatalog(null));
  }, []);

  const modelIdsForProvider = (providerId: string | null | undefined): string[] => {
    if (!catalog) return [];
    if (!providerId) {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of catalog.providers) {
        for (const m of p.models) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            out.push(m.id);
          }
        }
      }
      return out;
    }
    const provider = catalog.providers.find((p) => p.id === providerId);
    return provider ? provider.models.map((m) => m.id) : [];
  };

  const providerById = (providerId: string | null | undefined): CatalogProvider | null => {
    if (!catalog || !providerId) return null;
    return catalog.providers.find((p) => p.id === providerId) ?? null;
  };

  return { catalog, modelIdsForProvider, providerById };
}
