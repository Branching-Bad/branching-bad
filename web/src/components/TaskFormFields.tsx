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
  agentProfileId: string; setAgentProfileId: (v: string) => void;
  agentProfiles: AgentProfile[];
  autoFocus?: boolean;
}) {
  return (
    <>
      <input
        autoFocus={autoFocus}
        className={inputClass}
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={`${inputClass} min-h-[92px] resize-none`}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <select
        className={selectClass}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      >
        <option value="">Priority (optional)</option>
        <option value="Highest">Highest</option>
        <option value="High">High</option>
        <option value="Medium">Medium</option>
        <option value="Low">Low</option>
        <option value="Lowest">Lowest</option>
      </select>

      <select
        className={selectClass}
        value={agentProfileId}
        onChange={(e) => setAgentProfileId(e.target.value)}
      >
        <option value="">Agent / Model (repo default)</option>
        {agentProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.agent_name} / {p.model}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={requirePlan}
          onChange={(e) => setRequirePlan(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
        />
        Require plan approval before execution
      </label>
      <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={autoApprovePlan}
          onChange={(e) => setAutoApprovePlan(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
        />
        Auto Approve Plan
      </label>
      <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => setAutoStart(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
        />
        {requirePlan
          ? (autoApprovePlan
              ? "Autostart (auto approve + run)"
              : "Autostart (generate plan+tasklist, wait for approval)")
          : "Autostart (direct run)"}
      </label>
      <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={useWorktree}
          onChange={(e) => setUseWorktree(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
        />
        {useWorktree
          ? "Worktree isolation (agent works in separate worktree)"
          : "Direct mode (agent works on current branch)"}
      </label>
    </>
  );
}
