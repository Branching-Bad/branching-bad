import type { Repo, AgentProfile, AnalystHistoryEntry } from "../types";
import { IconPlus, IconAnalyst, IconChevronDown } from "./Icons";
import ProfileBadge from "./ProfileBadge";
import SessionList from "./SessionList";

interface Props {
  repos: Repo[];
  profiles: AgentProfile[];
  selectedRepoId: string | null;
  selectedProfileId: string;
  onRepoChange: (id: string) => void;
  onProfileChange: (id: string) => void;
  onNewSession: () => void;
  history: AnalystHistoryEntry[];
  viewingHistoryId: string | null;
  activeSessionId: string | null;
  onSelectHistory: (id: string) => void;
  onDeleteHistory: (id: string) => void;
}

export default function Sidebar({
  repos, profiles, selectedRepoId, selectedProfileId,
  onRepoChange, onProfileChange, onNewSession,
  history, viewingHistoryId, activeSessionId,
  onSelectHistory, onDeleteHistory,
}: Props) {
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <aside className="w-72 flex flex-col bg-surface-100 border-r border-border-default h-screen">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border-default">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
            <IconAnalyst className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary tracking-tight">Task Analyst</h1>
            <p className="text-[10px] text-text-muted">AI-powered task analysis</p>
          </div>
        </div>

        {/* Repo selector */}
        <div className="space-y-2">
          <div className="relative">
            <select
              value={selectedRepoId ?? ""}
              onChange={(e) => onRepoChange(e.target.value)}
              className="w-full appearance-none bg-surface-200 border border-border-default rounded-lg px-3 py-1.5 pr-8 text-xs text-text-primary cursor-pointer hover:border-border-strong transition-colors outline-none"
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <IconChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          </div>

          {/* Profile selector */}
          <div className="relative">
            <select
              value={selectedProfileId}
              onChange={(e) => onProfileChange(e.target.value)}
              className="w-full appearance-none bg-surface-200 border border-border-default rounded-lg px-3 py-1.5 pr-8 text-xs text-text-primary cursor-pointer hover:border-border-strong transition-colors outline-none"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.provider} / {p.agent_name}</option>
              ))}
            </select>
            <IconChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          </div>

          <ProfileBadge profile={selectedProfile} />
        </div>
      </div>

      {/* New session button */}
      <div className="px-3 pt-3 pb-1">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-brand/8 border border-brand/15 text-brand text-xs font-medium hover:bg-brand/15 hover:border-brand/25 transition-all"
        >
          <IconPlus />
          New Session
          <kbd className="ml-auto text-[10px] font-mono text-brand/50">
            {navigator.platform.includes("Mac") ? "\u2318" : "^"}K
          </kbd>
        </button>
      </div>

      {/* Active session indicator */}
      {activeSessionId && !viewingHistoryId && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-brand/5 border border-brand/10">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            <span className="text-[11px] text-brand font-medium">Active session</span>
          </div>
        </div>
      )}

      {/* History */}
      <div className="flex-1 overflow-y-auto mt-2 pb-4">
        <SessionList
          entries={history}
          activeId={viewingHistoryId}
          onSelect={onSelectHistory}
          onDelete={onDeleteHistory}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border-default">
        <p className="text-[10px] text-text-muted text-center">
          Standalone Task Analyst
        </p>
      </div>
    </aside>
  );
}
