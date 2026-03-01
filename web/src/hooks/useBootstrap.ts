import { useState, useCallback, useEffect } from "react";
import { api } from "../api";
import type { Repo, AgentProfile, ProviderMeta } from "../types";

export function useBootstrap() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [providerMetas, setProviderMetas] = useState<ProviderMeta[]>([]);
  const [providerItemCounts, setProviderItemCounts] = useState<Record<string, number>>({});

  const bootstrap = useCallback(async () => {
    const payload = await api<{
      repos: Repo[];
      agentProfiles: AgentProfile[];
      providers?: ProviderMeta[];
      providerItemCounts?: Record<string, number>;
    }>("/api/bootstrap");
    setRepos(payload.repos);
    setAgentProfiles(payload.agentProfiles ?? []);
    if (payload.providers) setProviderMetas(payload.providers);
    if (payload.providerItemCounts) setProviderItemCounts(payload.providerItemCounts);
    return payload;
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  return {
    repos, agentProfiles, setAgentProfiles,
    providerMetas, providerItemCounts,
    bootstrap,
  };
}
