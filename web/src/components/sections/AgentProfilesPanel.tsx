import type { AgentProfile } from "../../types";
import { api } from "../../api";
import { useAgentCatalog } from "../../hooks/useAgentCatalog";
import { EffortSelect } from "../EffortSelect";
import { IconRefresh } from "../icons";
import { selectClass, btnPrimary, btnSecondary } from "../shared";
import { AgentProfileMcpPanel } from "../../mcp/AgentProfileMcpPanel";

export function AgentProfilesPanel({
  agentProfiles,
  setAgentProfiles,
  selectedProfileId,
  setSelectedProfileId,
  selectedProfile,
  busy,
  discoverAgents,
  saveAgentSelection,
}: {
  agentProfiles: AgentProfile[];
  setAgentProfiles?: (profiles: AgentProfile[]) => void;
  selectedProfileId: string;
  setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
}) {
  const { providerById } = useAgentCatalog();
  const provider = providerById(selectedProfile?.provider);

  const updateEffort = async (effort: string | null) => {
    if (!selectedProfile) return;
    try {
      const resp = await api<{ profile: AgentProfile }>(
        `/api/agents/${selectedProfile.id}/effort`,
        { method: "POST", body: JSON.stringify({ effort }) },
      );
      if (setAgentProfiles && resp.profile) {
        setAgentProfiles(agentProfiles.map((p) => (p.id === resp.profile.id ? resp.profile : p)));
      }
    } catch (e) {
      console.error("Failed to update effort default:", e);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Agent / Model</label>
        <select className={selectClass} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
          <option value="">Select agent/model</option>
          {agentProfiles.map((p) => (
            <option key={p.id} value={p.id}>{`${p.agent_name} \u00B7 ${p.model}`}</option>
          ))}
        </select>
        {selectedProfile && (
          <p className="mt-2 text-xs text-text-muted">
            {selectedProfile.provider} &middot; <code className="text-text-secondary">{selectedProfile.command}</code>
          </p>
        )}
      </div>
      {selectedProfile && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">
            Reasoning Effort
          </label>
          <EffortSelect
            provider={provider}
            value={selectedProfile.effort_default ?? null}
            onChange={updateEffort}
            emptyLabel="Provider default"
            className="w-full rounded-md border border-border-strong bg-surface-100 px-2 py-1.5 text-sm text-text-secondary focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {provider?.effort?.supported === false && (
            <p className="mt-1.5 text-[11px] text-text-muted">
              {provider.name} doesn&apos;t expose reasoning effort via CLI.
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={saveAgentSelection} disabled={busy} className={btnPrimary}>Save for Repo</button>
        <button onClick={discoverAgents} disabled={busy} className={btnSecondary}>
          <span className="flex items-center gap-1.5">
            <IconRefresh className="h-3.5 w-3.5" />
            Discover
          </span>
        </button>
      </div>
      {selectedProfile && (
        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            MCP servers
          </h4>
          <div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-2">
            <AgentProfileMcpPanel profileId={selectedProfile.id} />
          </div>
        </section>
      )}
    </div>
  );
}
