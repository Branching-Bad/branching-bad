import { useState, useEffect } from "react";
import type { AgentProfile, Task } from "../types";
import { IconX } from "./icons";
import { TaskFormFields } from "./TaskFormFields";
import type { TaskFormValues } from "./CreateTaskModal";

export function EditTaskModal({
  open, onClose, busy,
  task,
  agentProfiles,
  onSave,
}: {
  open: boolean; onClose: () => void; busy: boolean;
  task: Task | null;
  agentProfiles: AgentProfile[];
  onSave: (taskId: string, fields: TaskFormValues) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [requirePlan, setRequirePlan] = useState(true);
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const [carryDirtyState, setCarryDirtyState] = useState(false);
  const [agentProfileId, setAgentProfileId] = useState("");

  const taskId = task?.id;
  useEffect(() => {
    if (!task || !open) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority ?? "");
    setRequirePlan(task.require_plan);
    setAutoApprovePlan(task.auto_approve_plan);
    setAutoStart(task.auto_start);
    setUseWorktree(task.use_worktree);
    setCarryDirtyState(task.carry_dirty_state);
    setAgentProfileId(task.agent_profile_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, open]);

  if (!open || !task) return null;

  const handleSave = async () => {
    await onSave(task.id, {
      title, description, priority,
      requirePlan, autoApprovePlan, autoStart,
      useWorktree, carryDirtyState, agentProfileId,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex h-[min(85vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border-default bg-surface-100/70 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {task.jira_issue_key && (
              <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                {task.jira_issue_key}
              </span>
            )}
            <h3 className="text-[15px] font-semibold text-text-primary">Edit task</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition hover:bg-surface-200 hover:text-text-primary"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </header>

        <form
          onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 px-6 py-5">
            <TaskFormFields
              title={title} setTitle={setTitle}
              description={description} setDescription={setDescription}
              priority={priority} setPriority={setPriority}
              requirePlan={requirePlan} setRequirePlan={setRequirePlan}
              autoApprovePlan={autoApprovePlan} setAutoApprovePlan={setAutoApprovePlan}
              autoStart={autoStart} setAutoStart={setAutoStart}
              useWorktree={useWorktree} setUseWorktree={setUseWorktree}
              carryDirtyState={carryDirtyState} setCarryDirtyState={setCarryDirtyState}
              agentProfileId={agentProfileId} setAgentProfileId={setAgentProfileId}
              agentProfiles={agentProfiles}
              autoFocus
            />
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border-default bg-surface-100/70 px-6 py-3 backdrop-blur-md">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border-default bg-surface-200 px-4 py-1.5 text-[12px] font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40 disabled:hover:bg-brand"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 6.5L5 9.5L10 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Save
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
