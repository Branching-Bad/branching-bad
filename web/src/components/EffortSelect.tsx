import type { CatalogProvider } from "../hooks/useAgentCatalog";

const CANONICAL_EFFORTS: Array<"minimal" | "low" | "medium" | "high" | "max"> = [
  "minimal",
  "low",
  "medium",
  "high",
  "max",
];

export function EffortSelect({
  provider,
  value,
  onChange,
  emptyLabel = "Default",
  className,
  disabledTitle,
}: {
  provider: CatalogProvider | null;
  value: string | null;
  onChange: (v: string | null) => void;
  emptyLabel?: string;
  className?: string;
  disabledTitle?: string;
}) {
  const effort = provider?.effort;
  const supported = effort?.supported === true;

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={!supported}
      title={
        !supported
          ? disabledTitle ?? `${provider?.name ?? "This provider"} doesn't support effort selection`
          : undefined
      }
      className={
        className ??
        "rounded-md border border-border-strong bg-surface-100 px-2 py-1.5 text-[11px] text-text-secondary focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      <option value="">{emptyLabel}</option>
      {CANONICAL_EFFORTS.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  );
}
