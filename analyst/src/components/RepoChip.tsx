interface Props {
  name: string;
  active?: boolean;
}

export default function RepoChip({ name, active }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? "bg-brand-tint text-brand border border-brand/20"
          : "bg-surface-300 text-text-secondary border border-border-default"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-brand" : "bg-text-muted"}`} />
      {name}
    </span>
  );
}
