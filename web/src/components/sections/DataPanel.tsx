import { useCallback, useState } from "react";
import { api } from "../../api";
import { btnPrimary } from "../shared";

function UpdateSection() {
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleUpdate = useCallback(async () => {
    setUpdating(true); setResult(null);
    try {
      const res = await api<{ success: boolean; message: string }>("/api/system/update", { method: "POST" });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: (e as Error).message });
    } finally { setUpdating(false); }
  }, []);

  return (
    <div className="rounded-xl border border-border-default bg-surface-200 p-5 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-text-secondary">Application Update</h4>
        <p className="mt-1 text-[11px] text-text-muted">
          Pull latest changes from GitHub and install dependencies.
        </p>
      </div>
      <button
        onClick={() => void handleUpdate()}
        disabled={updating}
        className={btnPrimary + " text-[11px]"}
      >
        {updating ? "Updating..." : "Check for Updates"}
      </button>
      {result && (
        <pre className={`mt-2 rounded-lg border px-3 py-2 text-[11px] whitespace-pre-wrap ${
          result.success
            ? "border-brand/30 bg-brand-tint text-brand"
            : "border-error-border bg-error-bg text-error-text"
        }`}>{result.message}</pre>
      )}
    </div>
  );
}

export function DataPanel({
  onClearOutputs,
}: {
  onClearOutputs?: () => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <UpdateSection />
      <div className="rounded-xl border border-border-default bg-surface-200 p-5 space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-text-secondary">Live Output Logs</h4>
          <p className="mt-1 text-[11px] text-text-muted">
            Clear all persisted live output logs for all tasks. This frees up storage but removes output history.
          </p>
        </div>
        <button
          onClick={() => void onClearOutputs?.()}
          className="rounded-md bg-status-danger px-4 py-1.5 text-[11px] font-medium text-white transition hover:bg-status-danger/90"
        >
          Clear All Outputs
        </button>
      </div>
    </div>
  );
}
