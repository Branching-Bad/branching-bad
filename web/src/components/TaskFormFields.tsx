import type { AgentProfile } from "../types";
import { inputClass, selectClass } from "./shared";

export function TaskFormFields({
  title, setTitle,
  description, setDescription,
  priority, setPriority,
  requirePlan, setRequirePlan,
  autoApprovePlan, setAutoApprovePlan,
  autoStart, setAutoStart,
  useWorktree, setUseWorktree,
  carryDirtyState, setCarryDirtyState,
  agentProfileId, setAgentProfileId,
  agentProfiles,
  autoFocus,
}: {
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  priority: string; setPriority: (v: string) => void;
  requirePlan: boolean; setRequirePlan: (v: boolean) => void;
  autoApprovePlan: boolean; setAutoApprovePlan: (v: boolean) => void;
  autoStart: boolean; setAutoStart: (v: boolean) => void;
  useWorktree: boolean; setUseWorktree: (v: boolean) => void;
  carryDirtyState: boolean; setCarryDirtyState: (v: boolean) => void;
  agentProfileId: string; setAgentProfileId: (v: string) => void;
  agentProfiles: AgentProfile[];
  autoFocus?: boolean;
}) {
  return (
    <div className="flex gap-0 flex-1 min-h-0">
      {/* Sol sidebar */}
      <div className="w-[200px] shrink-0 border-r border-border-default pr-4 space-y-3">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Priority</label>
          <select
            className={selectClass}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">(optional)</option>
            <option value="Highest">Highest</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="Lowest">Lowest</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">Agent / Model</label>
          <select
            className={selectClass}
            value={agentProfileId}
            onChange={(e) => setAgentProfileId(e.target.value)}
          >
            <option value="">(repo default)</option>
            {agentProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.agent_name} / {p.model}
              </option>
            ))}
          </select>
        </div>
        <hr className="border-border-default" />
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={requirePlan}
            onChange={(e) => setRequirePlan(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
          />
          Require plan
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={autoApprovePlan}
            onChange={(e) => setAutoApprovePlan(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
          />
          Auto approve
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
          />
          Autostart
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
          />
          Worktree
        </label>
        {useWorktree && (
          <label className="flex items-center gap-2 text-xs text-text-secondary pl-5">
            <input
              type="checkbox"
              checked={carryDirtyState}
              onChange={(e) => setCarryDirtyState(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            Include uncommitted
          </label>
        )}
      </div>

      {/* Sag content */}
      <div className="flex-1 pl-5 flex flex-col gap-3 min-h-0">
        <input
          autoFocus={autoFocus}
          className={inputClass}
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className={`${inputClass} flex-1 resize-none min-h-0`}
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </div>
  );
}
