import { useState, useMemo, useCallback } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import type { Repo, AgentProfile } from "../types";

export function useRepoSelection({
  repos, agentProfiles, setAgentProfiles, bootstrap,
  setError, setInfo, setBusy,
}: {
  repos: Repo[];
  agentProfiles: AgentProfile[];
  setAgentProfiles: React.Dispatch<React.SetStateAction<AgentProfile[]>>;
  bootstrap: () => Promise<unknown>;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
  setBusy: (v: boolean) => void;
}) {
  const [selectedRepoId, _setSelectedRepoId] = useState(() => localStorage.getItem("bb:selectedRepoId") ?? "");
  const [selectedProfileId, _setSelectedProfileId] = useState(() => localStorage.getItem("bb:selectedProfileId") ?? "");
  const [repoPath, setRepoPath] = useState("");
  const [repoName, setRepoName] = useState("");

  const setSelectedRepoId = useCallback((id: string) => {
    _setSelectedRepoId(id);
    if (id) localStorage.setItem("bb:selectedRepoId", id);
    else localStorage.removeItem("bb:selectedRepoId");
  }, []);

  const setSelectedProfileId = useCallback((id: string) => {
    _setSelectedProfileId(id);
    if (id) localStorage.setItem("bb:selectedProfileId", id);
    else localStorage.removeItem("bb:selectedProfileId");
  }, []);

  const selectedRepo = useMemo(() => repos.find((r) => r.id === selectedRepoId) ?? null, [repos, selectedRepoId]);
  const selectedProfile = useMemo(() => agentProfiles.find((p) => p.id === selectedProfileId) ?? null, [agentProfiles, selectedProfileId]);

  // Auto-select first repo on bootstrap (only if no persisted selection)
  const initRepoId = useCallback((repoList: Repo[]) => {
    if (repoList.length === 0) return;
    _setSelectedRepoId((prev) => {
      if (prev && repoList.some((r) => r.id === prev)) return prev;
      const first = repoList[0].id;
      localStorage.setItem("bb:selectedRepoId", first);
      return first;
    });
  }, []);

  const onRepoSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault(); setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/repos", { method: "POST", body: JSON.stringify({ path: repoPath, name: repoName || undefined }) });
      setRepoPath(""); setRepoName("");
      setInfo("Repository saved.");
      await bootstrap();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [repoPath, repoName, bootstrap, setError, setInfo, setBusy]);

  const discoverAgents = useCallback(async () => {
    setError(""); setInfo(""); setBusy(true);
    try {
      const payload = await api<{ profiles: AgentProfile[]; synced: number }>("/api/agents/discover");
      setAgentProfiles(payload.profiles);
      setInfo(`${payload.synced} agent profiles updated.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [setAgentProfiles, setError, setInfo, setBusy]);

  const saveAgentSelection = useCallback(async () => {
    if (!selectedRepoId || !selectedProfileId) { setError("Repo and agent profile required."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/agents/select", { method: "POST", body: JSON.stringify({ repoId: selectedRepoId, profileId: selectedProfileId }) });
      setInfo("Agent profile saved for repo.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedRepoId, selectedProfileId, setError, setInfo, setBusy]);

  return {
    selectedRepoId, setSelectedRepoId,
    selectedProfileId, setSelectedProfileId,
    repoPath, setRepoPath,
    repoName, setRepoName,
    selectedRepo, selectedProfile,
    initRepoId,
    onRepoSubmit, discoverAgents, saveAgentSelection,
  };
}
