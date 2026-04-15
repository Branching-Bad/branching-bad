import type { AgentProfile, Repo, RepositoryRule } from "../types";
import { RulesPanel } from "../components/sections/RulesPanel";
import { ViewShell } from "./ViewShell";

export function RulesView(props: {
  selectedRepoId: string;
  selectedRepo: Repo | undefined;
  agentProfiles: AgentProfile[];
  globalRules: RepositoryRule[];
  repoRules: RepositoryRule[];
  onAddRule: (repoId: string | null, content: string) => Promise<void>;
  onUpdateRule: (id: string, content: string) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onOptimizeRules: (profileId: string, repoId?: string, instruction?: string, scope?: string) => Promise<string[]>;
  onBulkReplaceRules: (repoId: string | null, contents: string[]) => Promise<void>;
  onRulesRefresh: () => void;
}) {
  return (
    <ViewShell title="Rules" subtitle="Global and per-repo rules, plus AI optimizer">
      <RulesPanel {...props} />
    </ViewShell>
  );
}
