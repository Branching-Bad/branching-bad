import type { ToastMessage } from "../types";

interface Props {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
  onNavigate: (taskId: string, repoId: string) => void;
}

function toastIcon(type: ToastMessage["type"]) {
  if (type === "success") return <span className="text-status-success font-bold text-sm">✓</span>;
  if (type === "error") return <span className="text-status-danger font-bold text-sm">✗</span>;
  return <span className="text-status-info font-bold text-sm">i</span>;
}

function toastBorderColor(type: ToastMessage["type"]) {
  if (type === "success") return "border-status-success/50";
  if (type === "error") return "border-status-danger/50";
  return "border-status-info/50";
}

export function ToastNotification({ toasts, onDismiss, onNavigate }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 w-72 rounded-lg bg-surface-100 border ${toastBorderColor(toast.type)} px-4 py-3 shadow-lg`}
        >
          <button
            type="button"
            onClick={() => { onNavigate(toast.taskId, toast.repoId); onDismiss(toast.id); }}
            className="flex items-start gap-3 flex-1 text-left min-w-0"
          >
            <span className="mt-0.5 shrink-0">{toastIcon(toast.type)}</span>
            <span className="text-text-primary text-sm font-medium leading-snug break-words">{toast.title}</span>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-text-muted hover:text-text-secondary text-lg leading-none transition-colors"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
