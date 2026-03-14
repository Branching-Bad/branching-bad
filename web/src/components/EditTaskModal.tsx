import { useState, useEffect } from "react";
import type { AgentProfile, Task } from "../types";
import { IconX } from "./icons";
import { btnPrimary, btnSecondary } from "./shared";
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

  // Populate form only when a different task is opened (not on every re-render)
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
    await onSave(task.id, { title, description, priority, requirePlan, autoApprovePlan, autoStart, useWorktree, carryDirtyState, agentProfileId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[86%] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-base font-medium text-text-primary">Edit Task</h3>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
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
            carryDirtyState={carryDirtyState} setCarryDirtyState={setCarryDirtyState}
            agentProfileId={agentProfileId} setAgentProfileId={setAgentProfileId}
            agentProfiles={agentProfiles}
            autoFocus
          />
          <div className="flex gap-2 pt-3">
            <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
              Save
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
