import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
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

// SF system colors by severity
const PRIORITY_OPTIONS: Array<{ value: string; label: string; dot: string | null }> = [
  { value: "",        label: "No priority", dot: null },
  { value: "Highest", label: "Highest",     dot: "#FF453A" },
  { value: "High",    label: "High",        dot: "#FF9F0A" },
  { value: "Medium",  label: "Medium",      dot: "#FFD60A" },
  { value: "Low",     label: "Low",         dot: "#0A84FF" },
  { value: "Lowest",  label: "Lowest",      dot: "#8E8E93" },
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
    <div className="flex h-full min-h-0 gap-4">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto">
        <FieldGroup title="Details">
          <Field label="Priority">
            <PriorityPicker value={priority} onChange={setPriority} />
          </Field>
          <Field label="Agent / model">
            <AgentPicker value={agentProfileId} onChange={setAgentProfileId} profiles={agentProfiles} />
          </Field>
        </FieldGroup>

        <FieldGroup title="Behaviour" divided>
          <SwitchRow checked={requirePlan}     onChange={setRequirePlan}     label="Require plan" />
          <SwitchRow checked={autoApprovePlan} onChange={setAutoApprovePlan} label="Auto approve" disabled={!requirePlan} />
          <SwitchRow checked={autoStart}       onChange={setAutoStart}       label="Autostart" />
          <SwitchRow checked={useWorktree}     onChange={setUseWorktree}     label="Use worktree" />
          {useWorktree && (
            <SwitchRow
              checked={carryDirtyState}
              onChange={setCarryDirtyState}
              label="Include uncommitted"
              indent
            />
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
// Compact picker — trigger + inline popover menu (click-outside to close)
// ─────────────────────────────────────────────────────────────────────────────

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const Dot: FC<{ color: string | null }> = ({ color }) =>
  color ? (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}
    />
  ) : (
    <span className="h-2 w-2 shrink-0 rounded-full border border-border-strong" />
  );

const TriggerButton: FC<{ onClick: () => void; open: boolean; children: ReactNode }> = ({ onClick, open, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] border bg-surface-200 px-2.5 py-1.5 text-left text-[12px] transition ${
      open
        ? "border-border-focus shadow-[0_0_0_3px_var(--color-brand-glow)]"
        : "border-border-default hover:border-border-strong"
    }`}
  >
    {children}
    <svg
      className={`ml-auto h-3 w-3 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 12 12" fill="none"
    >
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  </button>
);

const MenuList: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
    <div className="max-h-56 overflow-y-auto py-0.5">{children}</div>
  </div>
);

const MenuItem: FC<{ selected?: boolean; onClick: () => void; children: ReactNode }> = ({ selected, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition ${
      selected
        ? "bg-brand-tint text-text-primary"
        : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
    }`}
  >
    {children}
    {selected && (
      <svg className="ml-auto h-3 w-3 text-brand" viewBox="0 0 12 12" fill="none">
        <path d="M2 6.3L5 9L10 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Priority picker
// ─────────────────────────────────────────────────────────────────────────────

const PriorityPicker: FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const { open, setOpen, ref } = usePopover();
  const current = PRIORITY_OPTIONS.find((o) => o.value === value) ?? PRIORITY_OPTIONS[0];
  return (
    <div className="relative" ref={ref}>
      <TriggerButton onClick={() => setOpen((v) => !v)} open={open}>
        <Dot color={current.dot} />
        <span className={`truncate ${current.value ? "text-text-primary" : "text-text-muted"}`}>
          {current.label}
        </span>
      </TriggerButton>
      {open && (
        <MenuList>
          {PRIORITY_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value || "none"}
              selected={opt.value === value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <Dot color={opt.dot} />
              <span className="flex-1 truncate">{opt.label}</span>
            </MenuItem>
          ))}
        </MenuList>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent picker
// ─────────────────────────────────────────────────────────────────────────────

const AgentPicker: FC<{ value: string; onChange: (v: string) => void; profiles: AgentProfile[] }> = ({ value, onChange, profiles }) => {
  const { open, setOpen, ref } = usePopover();
  const selected = profiles.find((p) => p.id === value) ?? null;
  return (
    <div className="relative" ref={ref}>
      <TriggerButton onClick={() => setOpen((v) => !v)} open={open}>
        {selected ? (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold text-brand">
              {selected.agent_name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 truncate text-text-primary">
              {selected.agent_name}
              <span className="text-text-muted"> · {selected.model}</span>
            </span>
          </>
        ) : (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-300 text-[10px] text-text-muted">·</span>
            <span className="truncate text-text-muted">Repo default</span>
          </>
        )}
      </TriggerButton>
      {open && (
        <MenuList>
          <MenuItem selected={value === ""} onClick={() => { onChange(""); setOpen(false); }}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-300 text-[10px] text-text-muted">·</span>
            <span className="flex-1 truncate text-text-muted">Repo default</span>
          </MenuItem>
          {profiles.map((p) => (
            <MenuItem key={p.id} selected={p.id === value} onClick={() => { onChange(p.id); setOpen(false); }}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10px] font-semibold text-brand">
                {p.agent_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {p.agent_name}
                <span className="text-text-muted"> · {p.model}</span>
              </span>
            </MenuItem>
          ))}
        </MenuList>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Compact SF switch row — label + switch, no hint (hover title shows tooltip)
// ─────────────────────────────────────────────────────────────────────────────

const SwitchRow: FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  indent?: boolean;
}> = ({ checked, onChange, label, disabled, indent }) => (
  <label
    className={`flex cursor-pointer items-center gap-2.5 py-2 text-[12.5px] ${
      disabled ? "cursor-not-allowed opacity-40" : ""
    } ${indent ? "pl-4" : ""}`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="flex items-center gap-1.5 text-text-primary">
      {indent && <span className="h-2 w-2 rounded-sm border-l border-b border-border-strong" />}
      {label}
    </span>
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────
// Field primitives
// ─────────────────────────────────────────────────────────────────────────────

const FieldGroup: FC<{ title: string; children: ReactNode; divided?: boolean }> = ({ title, children, divided }) => (
  <section className="space-y-2">
    <h4 className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
      {title}
    </h4>
    <div
      className={`rounded-[var(--radius-lg)] border border-border-default bg-surface-100/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_1px_2px_rgba(0,0,0,0.2)] backdrop-blur-sm ${
        divided
          ? "px-3 [&>*+*]:border-t [&>*+*]:border-border-default/50"
          : "space-y-3 p-3"
      }`}
    >
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
