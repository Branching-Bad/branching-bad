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

// ── Priority palette (SF system colors, by severity) ─────────────────────────
const PRIORITY_OPTIONS: Array<{ value: string; label: string; dot: string | null }> = [
  { value: "",        label: "No priority", dot: null },
  { value: "Highest", label: "Highest",     dot: "#FF453A" }, // systemRed
  { value: "High",    label: "High",        dot: "#FF9F0A" }, // systemOrange
  { value: "Medium",  label: "Medium",      dot: "#FFD60A" }, // systemYellow
  { value: "Low",     label: "Low",         dot: "#0A84FF" }, // systemBlue
  { value: "Lowest",  label: "Lowest",      dot: "#8E8E93" }, // systemGray
];

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
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-[260px] shrink-0 flex-col gap-5 overflow-y-auto pr-1">
        {/* Details */}
        <FieldGroup title="Details">
          <Field label="Priority">
            <PriorityPicker value={priority} onChange={setPriority} />
          </Field>
          <Field label="Agent / model">
            <AgentPicker
              value={agentProfileId}
              onChange={setAgentProfileId}
              profiles={agentProfiles}
            />
          </Field>
        </FieldGroup>

        {/* Behaviour */}
        <FieldGroup title="Behaviour">
          <SwitchRow
            checked={requirePlan}
            onChange={setRequirePlan}
            label="Require plan"
            hint="Agent drafts a plan before making changes."
          />
          <SwitchRow
            checked={autoApprovePlan}
            onChange={setAutoApprovePlan}
            disabled={!requirePlan}
            label="Auto approve"
            hint="Skip human review of the drafted plan."
          />
          <SwitchRow
            checked={autoStart}
            onChange={setAutoStart}
            label="Autostart"
            hint="Begin work as soon as the task is ready."
          />
          <SwitchRow
            checked={useWorktree}
            onChange={setUseWorktree}
            label="Use worktree"
            hint="Isolate changes in a separate branch."
          />
          {useWorktree && (
            <div className="mt-0.5 border-l border-border-default/60 pl-3">
              <SwitchRow
                checked={carryDirtyState}
                onChange={setCarryDirtyState}
                label="Include uncommitted"
                hint="Copy dirty files into the worktree on create."
                dense
              />
            </div>
          )}
        </FieldGroup>
      </aside>

      {/* ── Right: title + description ─────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <input
          autoFocus={autoFocus}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title…"
          className="w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2.5 text-[14px] font-medium text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the task in detail — behaviour, context, acceptance criteria…"
          className="min-h-0 w-full flex-1 resize-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2.5 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority picker — vertical SF-style radio list with colored dots
// ─────────────────────────────────────────────────────────────────────────────

const PriorityPicker: FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div className="overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-surface-200">
    {PRIORITY_OPTIONS.map((opt, idx) => {
      const selected = value === opt.value;
      return (
        <button
          key={opt.value || "none"}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12px] transition ${
            idx > 0 ? "border-t border-border-default/40" : ""
          } ${
            selected
              ? "bg-brand-tint text-text-primary"
              : "text-text-secondary hover:bg-surface-300 hover:text-text-primary"
          }`}
        >
          {opt.dot ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.2)_inset]"
              style={{ backgroundColor: opt.dot }}
            />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full border border-border-strong" />
          )}
          <span className="flex-1">{opt.label}</span>
          {selected && (
            <svg className="h-3 w-3 text-brand" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.3L5 9L10 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      );
    })}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent picker — card with avatar + name + model subtext
// ─────────────────────────────────────────────────────────────────────────────

const AgentPicker: FC<{ value: string; onChange: (v: string) => void; profiles: AgentProfile[] }> = ({ value, onChange, profiles }) => {
  const selected = profiles.find((p) => p.id === value) ?? null;
  const display = selected
    ? { primary: selected.agent_name, secondary: selected.model, avatar: selected.agent_name.charAt(0).toUpperCase() }
    : { primary: "Repo default", secondary: "Use the repo's default profile", avatar: "·" };

  return (
    <div className="relative rounded-[var(--radius-md)] border border-border-default bg-surface-200 transition focus-within:border-border-focus focus-within:shadow-[0_0_0_3px_var(--color-brand-glow)]">
      <div className="pointer-events-none flex items-center gap-2.5 px-2.5 py-1.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
            selected ? "bg-brand-tint text-brand" : "bg-surface-300 text-text-muted"
          }`}
        >
          {display.avatar}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-text-primary">
            {display.primary}
          </span>
          <span className="block truncate text-[10px] text-text-muted">
            {display.secondary}
          </span>
        </span>
        <svg className="h-3 w-3 shrink-0 text-text-muted" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Repo default</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.agent_name} · {p.model}
          </option>
        ))}
      </select>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SF-style toggle switch row
// ─────────────────────────────────────────────────────────────────────────────

const SwitchRow: FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  dense?: boolean;
}> = ({ checked, onChange, label, hint, disabled, dense }) => (
  <div className={`flex items-start justify-between gap-3 ${dense ? "py-1" : "py-1.5"} ${disabled ? "opacity-40" : ""}`}>
    <div className="min-w-0 flex-1">
      <div className="text-[12px] font-medium text-text-primary">{label}</div>
      {hint && <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">{hint}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
        checked ? "bg-status-success" : "bg-surface-300"
      } disabled:cursor-not-allowed`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-all ${
          checked ? "left-[18px]" : "left-[2px]"
        }`}
      />
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Field primitives
// ─────────────────────────────────────────────────────────────────────────────

const FieldGroup: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {title}
    </h4>
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
      {children}
    </div>
  </section>
);

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <span className="text-[11px] font-medium text-text-secondary">{label}</span>
    {children}
  </div>
);
