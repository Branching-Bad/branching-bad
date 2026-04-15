import type { AgentProfile } from "../types";
import { AgentProfilesPanel } from "../components/sections/AgentProfilesPanel";
import { ViewShell } from "./ViewShell";

export function AgentsView(props: {
  agentProfiles: AgentProfile[];
  selectedProfileId: string;
  setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
}) {
  return (
    <ViewShell title="AI Agents" subtitle="Agent profiles and MCP assignment">
      <AgentProfilesPanel {...props} />
    </ViewShell>
  );
}
