import type { AgentProfile } from "../types";
import { IconX } from "./icons";
import { btnPrimary, btnSecondary } from "./shared";
import { TaskFormFields } from "./TaskFormFields";

export function CreateTaskModal({
  open, onClose, busy,
  title, setTitle, description, setDescription,
  priority, setPriority, requirePlan, setRequirePlan,
  autoApprovePlan, setAutoApprovePlan, autoStart, setAutoStart,
  useWorktree, setUseWorktree,
  agentProfileId, setAgentProfileId, agentProfiles,
  onCreate, repoName,
}: {
  open: boolean; onClose: () => void; busy: boolean;
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  priority: string; setPriority: (v: string) => void;
  requirePlan: boolean; setRequirePlan: (v: boolean) => void;
  autoApprovePlan: boolean; setAutoApprovePlan: (v: boolean) => void;
  autoStart: boolean; setAutoStart: (v: boolean) => void;
  useWorktree: boolean; setUseWorktree: (v: boolean) => void;
  agentProfileId: string; setAgentProfileId: (v: string) => void;
  agentProfiles: AgentProfile[];
  onCreate: () => void;
  repoName: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
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
          onSubmit={(e) => { e.preventDefault(); void onCreate(); }}
          className="space-y-3 px-6 py-5"
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
          <div className="flex gap-2 pt-1">
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
