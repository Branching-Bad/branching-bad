import { useState } from "react";
import type { AgentProfile } from "../types";
import { IconX } from "./icons";
import { btnPrimary, btnSecondary } from "./shared";
import { TaskFormFields } from "./TaskFormFields";

export type TaskFormValues = {
  title: string;
  description: string;
  priority: string;
  requirePlan: boolean;
  autoApprovePlan: boolean;
  autoStart: boolean;
  useWorktree: boolean;
  agentProfileId: string;
};

export function CreateTaskModal({
  open, onClose, busy,
  agentProfiles,
  onSubmit, repoName,
  prefill,
}: {
  open: boolean; onClose: () => void; busy: boolean;
  agentProfiles: AgentProfile[];
  onSubmit: (fields: TaskFormValues) => Promise<void>;
  repoName: string;
  prefill?: { title: string; description: string } | null;
}) {
  if (!open) return null;

  return (
    <CreateTaskModalInner
      onClose={onClose} busy={busy}
      agentProfiles={agentProfiles}
      onSubmit={onSubmit} repoName={repoName}
      prefill={prefill}
    />
  );
}

function CreateTaskModalInner({
  onClose, busy, agentProfiles, onSubmit, repoName, prefill,
}: {
  onClose: () => void; busy: boolean;
  agentProfiles: AgentProfile[];
  onSubmit: (fields: TaskFormValues) => Promise<void>;
  repoName: string;
  prefill?: { title: string; description: string } | null;
}) {
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [priority, setPriority] = useState("");
  const [requirePlan, setRequirePlan] = useState(true);
  const [autoApprovePlan, setAutoApprovePlan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [useWorktree, setUseWorktree] = useState(true);
  const [agentProfileId, setAgentProfileId] = useState("");

  const handleSubmit = async () => {
    await onSubmit({ title, description, priority, requirePlan, autoApprovePlan, autoStart, useWorktree, agentProfileId });
    setTitle(""); setDescription(""); setPriority("");
    setRequirePlan(true); setAutoApprovePlan(false); setAutoStart(false); setUseWorktree(true);
    setAgentProfileId("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[86%] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <div>
            <h3 className="text-base font-medium text-text-primary">Create Task</h3>
            <p className="mt-1 text-xs text-text-muted">This task will be added to To Do in {repoName}.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          className="flex flex-col px-6 py-5 h-[420px]"
        >
          <TaskFormFields
            title={title} setTitle={setTitle}
            description={description} setDescription={setDescription}
            priority={priority} setPriority={setPriority}
            requirePlan={requirePlan} setRequirePlan={setRequirePlan}
            autoApprovePlan={autoApprovePlan} setAutoApprovePlan={setAutoApprovePlan}
            autoStart={autoStart} setAutoStart={setAutoStart}
            useWorktree={useWorktree} setUseWorktree={setUseWorktree}
            agentProfileId={agentProfileId} setAgentProfileId={setAgentProfileId}
            agentProfiles={agentProfiles}
            autoFocus
          />
          <div className="flex gap-2 pt-3">
            <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
              Create in To Do
            </button>
            <button type="button" onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
