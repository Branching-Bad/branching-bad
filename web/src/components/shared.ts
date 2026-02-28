import type { LaneKey } from "../types";

export const inputClass =
  "w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors";
export const selectClass =
  "w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none transition-colors appearance-none";
export const btnPrimary =
  "rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-text-primary border border-brand-glow transition hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed";
export const btnSecondary =
  "rounded-md bg-surface-300 px-4 py-2 text-sm font-medium text-text-primary border border-border-strong transition hover:bg-surface-200 hover:border-border-strong disabled:opacity-40 disabled:cursor-not-allowed";

export function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export function laneFromStatus(status: string): LaneKey {
  const upper = status.toUpperCase();
  if (upper === "ARCHIVED") return "archived";
  if (upper === "DONE") return "done";
  if (upper === "IN_PROGRESS") return "inprogress";
  if (upper === "FAILED") return "todo";
  if (upper === "CANCELLED") return "todo";
  if (upper === "PLAN_GENERATING" || upper === "PLAN_DRAFTED" || upper === "PLAN_APPROVED" || upper === "PLAN_REVISE_REQUESTED") return "todo";
  const n = status.toLowerCase();
  if (n.includes("done")) return "done";
  if (n.includes("review")) return "inreview";
  if (n.includes("progress")) return "inprogress";
  return "todo";
}

export const laneMeta: Array<{ key: LaneKey; title: string; dot: string }> = [
  { key: "todo", title: "To Do", dot: "bg-text-muted" },
  { key: "inprogress", title: "In Progress", dot: "bg-brand" },
  { key: "inreview", title: "In Review", dot: "bg-info-text" },
  { key: "done", title: "Done", dot: "bg-brand" },
  { key: "archived", title: "Archive", dot: "bg-text-muted" },
];

export const planStatusColor = (status: string) => {
  switch (status) {
    case "approved": return "border-brand/40 bg-brand-tint text-brand";
    case "rejected": return "border-error-border bg-error-bg text-error-text";
    case "drafted": return "border-border-strong bg-surface-300 text-text-secondary";
    case "revise_requested": return "border-yellow-800 bg-yellow-950/40 text-yellow-400";
    default: return "border-border-strong bg-surface-300 text-text-muted";
  }
};

export const runStatusColor = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("done") || normalized.includes("success")) return "border-brand/40 bg-brand-tint text-brand";
  if (normalized.includes("cancel")) return "border-yellow-700 bg-yellow-950/40 text-yellow-400";
  if (normalized.includes("fail") || normalized.includes("error")) return "border-error-border bg-error-bg text-error-text";
  return "border-border-strong bg-surface-300 text-text-secondary";
};
