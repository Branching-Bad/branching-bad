import type { FC, ReactNode } from "react";
import type { AgentProfile } from "../types";

interface Props {
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
}

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
}: Props) {
  return (
    <div className="flex h-full min-h-0 gap-5">
      {/* ── Sidebar: meta & toggles ── */}
      <aside className="w-[220px] shrink-0 space-y-4 overflow-y-auto pr-1">
        <FieldGroup title="Details">
          <Field label="Priority">
            <StyledSelect value={priority} onChange={setPriority}>
              <option value="">—</option>
              <option value="Highest">Highest</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
              <option value="Lowest">Lowest</option>
            </StyledSelect>
          </Field>
          <Field label="Agent / model">
            <StyledSelect value={agentProfileId} onChange={setAgentProfileId}>
              <option value="">Repo default</option>
              {agentProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.agent_name} / {p.model}
                </option>
              ))}
            </StyledSelect>
          </Field>
        </FieldGroup>

        <FieldGroup title="Behaviour">
          <Toggle checked={requirePlan} onChange={setRequirePlan} label="Require plan" />
          <Toggle checked={autoApprovePlan} onChange={setAutoApprovePlan} label="Auto approve" />
          <Toggle checked={autoStart} onChange={setAutoStart} label="Autostart" />
          <Toggle checked={useWorktree} onChange={setUseWorktree} label="Use worktree" />
          {useWorktree && (
            <div className="pl-5">
              <Toggle
                checked={carryDirtyState}
                onChange={setCarryDirtyState}
                label="Include uncommitted"
                small
              />
            </div>
          )}
        </FieldGroup>
      </aside>

      {/* ── Right: title + description ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <input
          autoFocus={autoFocus}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title…"
          className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 text-[14px] font-medium text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="min-h-0 flex-1 w-full resize-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
        />
      </div>
    </div>
  );
}

// ── primitives ───────────────────────────────────────────────────────────────

const FieldGroup: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {title}
    </h4>
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-2.5">
      {children}
    </div>
  </section>
);

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-medium text-text-secondary">{label}</span>
    {children}
  </label>
);

const StyledSelect: FC<{ value: string; onChange: (v: string) => void; children: ReactNode }> = ({ value, onChange, children }) => (
  <div className="relative">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-2.5 py-1.5 pr-8 text-[12px] text-text-primary transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
    >
      {children}
    </select>
    <svg className="pointer-events-none absolute right-2.5 top-2.5 h-3 w-3 text-text-muted" viewBox="0 0 12 12">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  </div>
);

const Toggle: FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }> = ({ checked, onChange, label, small }) => (
  <label className={`flex cursor-pointer items-center justify-between gap-2 ${small ? "text-[11px]" : "text-[12px]"} text-text-secondary hover:text-text-primary`}>
    <span>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);
