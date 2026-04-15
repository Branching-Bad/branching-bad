import type { AgentProfile } from "../../types";
import { IconRefresh } from "../icons";
import { selectClass, btnPrimary, btnSecondary } from "../shared";
import { AgentProfileMcpPanel } from "../../mcp/AgentProfileMcpPanel";

export function AgentProfilesPanel({
  agentProfiles,
  selectedProfileId,
  setSelectedProfileId,
  selectedProfile,
  busy,
  discoverAgents,
  saveAgentSelection,
}: {
  agentProfiles: AgentProfile[];
  selectedProfileId: string;
  setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
}) {
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
