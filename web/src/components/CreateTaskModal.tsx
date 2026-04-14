import { useState, useEffect } from "react";
import type { AgentProfile, TaskDefaults } from "../types";
import { IconX } from "./icons";
import { TaskFormFields } from "./TaskFormFields";
import { api } from "../api";

export type TaskFormValues = {
  title: string;
  description: string;
  priority: string;
  requirePlan: boolean;
  autoApprovePlan: boolean;
  autoStart: boolean;
  useWorktree: boolean;
  carryDirtyState: boolean;
  agentProfileId: string;
};

export function CreateTaskModal({
  open, onClose, busy,
  agentProfiles,
  onSubmit, repoName,
  prefill,
  repoId,
}: {
  open: boolean; onClose: () => void; busy: boolean;
  agentProfiles: AgentProfile[];
  onSubmit: (fields: TaskFormValues) => Promise<void>;
  repoName: string;
  prefill?: { title: string; description: string } | null;
  repoId?: string;
}) {
  if (!open) return null;
  return (
    <CreateTaskModalInner
      onClose={onClose} busy={busy}
      agentProfiles={agentProfiles}
      onSubmit={onSubmit} repoName={repoName}
      prefill={prefill}
      repoId={repoId}
    />
  );
}

function CreateTaskModalInner({
  onClose, busy, agentProfiles, onSubmit, repoName, prefill, repoId,
}: {
  onClose: () => void; busy: boolean;
  agentProfiles: AgentProfile[];
  onSubmit: (fields: TaskFormValues) => Promise<void>;
  repoName: string;
  prefill?: { title: string; description: string } | null;
  repoId?: string;
}) {
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [priority, setPriority] = useState("");
  const [requirePlan, setRequirePlan] = useState(true);
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const [carryDirtyState, setCarryDirtyState] = useState(false);
  const [agentProfileId, setAgentProfileId] = useState("");

  useEffect(() => {
    if (!repoId) return;
    api<{ defaults: TaskDefaults | null }>(`/api/repos/${encodeURIComponent(repoId)}/task-defaults/resolve`)
      .then((res) => {
        if (res.defaults) {
          setRequirePlan(res.defaults.require_plan);
          setAutoApprovePlan(res.defaults.auto_approve_plan);
          setAutoStart(res.defaults.auto_start);
          setUseWorktree(res.defaults.use_worktree);
          setCarryDirtyState(res.defaults.carry_dirty_state);
          if (res.defaults.priority) setPriority(res.defaults.priority);
        }
      })
      .catch(() => {});
  }, [repoId]);

  const handleSubmit = async () => {
    await onSubmit({
      title, description, priority,
      requirePlan, autoApprovePlan, autoStart,
      useWorktree, carryDirtyState, agentProfileId,
    });
    setTitle(""); setDescription(""); setPriority("");
    setRequirePlan(true); setAutoApprovePlan(false); setAutoStart(false);
    setUseWorktree(true); setCarryDirtyState(false);
    setAgentProfileId("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex h-[min(85vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border-default bg-surface-100/70 px-6 py-4 backdrop-blur-md">
          <div className="space-y-0.5">
            <h3 className="text-[15px] font-semibold text-text-primary">Create task</h3>
            <p className="text-[12px] text-text-muted">
              Adds to <span className="text-text-secondary">{repoName}</span> · To&nbsp;Do lane
            </p>
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
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
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

          {/* Footer */}
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
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Create in To Do
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
