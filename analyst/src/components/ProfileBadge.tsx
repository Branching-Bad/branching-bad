import type { AgentProfile } from "../types";

interface Props {
  profile: AgentProfile | undefined;
  compact?: boolean;
}

export default function ProfileBadge({ profile, compact }: Props) {
  if (!profile) return null;

  if (compact) {
    return (
      <span className="text-[10px] text-text-muted font-medium tracking-wide uppercase">
        {profile.model.split("/").pop()?.split("-").slice(0, 2).join("-")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium text-text-secondary bg-surface-300 border border-border-default rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-brand/60" />
      {profile.provider}
      <span className="text-text-muted">/</span>
      {profile.model.split("/").pop()?.split("-").slice(0, 2).join("-")}
    </span>
  );
}
