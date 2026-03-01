import type { AgentProfile } from "../types";

export function AgentProfileSelect({
  profiles,
  value,
  onChange,
  className,
}: {
  profiles: AgentProfile[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  if (profiles.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "rounded-md border border-border-strong bg-surface-100 px-2 py-1.5 text-[11px] text-text-secondary focus:border-brand focus:outline-none"}
    >
      <option value="">Default Agent</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>{p.agent_name} · {p.model}</option>
      ))}
    </select>
  );
}
