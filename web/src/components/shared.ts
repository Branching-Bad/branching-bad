import type { LaneKey } from "../types";

export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]";
export const selectClass =
  "w-full appearance-none rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 pr-8 text-sm text-text-primary transition focus:border-border-focus focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-glow)]";
export const btnPrimary =
  "rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition hover:bg-brand-dark disabled:opacity-40 disabled:hover:bg-brand";
export const btnSecondary =
  "rounded-full border border-border-default bg-surface-200 px-4 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-surface-300 hover:text-text-primary disabled:opacity-40";

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
  if (upper === "PLAN_GENERATING" || upper === "PLAN_DRAFTED" || upper === "PLAN_APPROVED" || upper === "PLAN_REVISE_REQUESTED") return "inprogress";
  const n = status.toLowerCase();
  if (n.includes("done")) return "done";
  if (n.includes("review")) return "inreview";
  if (n.includes("progress")) return "inprogress";
  return "todo";
}

export const laneMeta: Array<{ key: LaneKey; title: string; dot: string }> = [
  { key: "todo", title: "To Do", dot: "bg-text-muted" },
  { key: "inprogress", title: "In Progress", dot: "bg-brand" },
  { key: "inreview", title: "In Review", dot: "bg-status-pending" },
  { key: "done", title: "Done", dot: "bg-status-success" },
  { key: "archived", title: "Archive", dot: "bg-text-muted" },
];

export const planStatusColor = (status: string) => {
  switch (status) {
    case "approved": return "border-status-success/30 bg-status-success-soft text-status-success";
    case "rejected": return "border-status-danger/30 bg-status-danger-soft text-status-danger";
    case "drafted": return "border-border-strong bg-surface-300 text-text-secondary";
    case "revise_requested": return "border-status-warning/30 bg-status-warning-soft text-status-warning";
    default: return "border-border-strong bg-surface-300 text-text-muted";
  }
};

export const runStatusColor = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("done") || normalized.includes("success")) return "border-status-success/30 bg-status-success-soft text-status-success";
  if (normalized.includes("cancel")) return "border-status-warning/30 bg-status-warning-soft text-status-warning";
  if (normalized.includes("fail") || normalized.includes("error")) return "border-status-danger/30 bg-status-danger-soft text-status-danger";
  return "border-border-strong bg-surface-300 text-text-secondary";
};

