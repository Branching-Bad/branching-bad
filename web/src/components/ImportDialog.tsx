import { useState, useRef } from "react";
import { btnPrimary, btnSecondary } from "./shared";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onImport: (file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}

export function ImportDialog({ open, title, onClose, onImport }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "update">("skip");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await onImport(file, strategy);
      setResult(res);
    } catch {
      setResult({ created: 0, updated: 0, skipped: -1 });
    }
    setImporting(false);
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setStrategy("skip");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative w-96 rounded-xl border border-border-default bg-surface-100 p-5 shadow-xl space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>

        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className={btnSecondary + " w-full !text-xs"}
          >
            {file ? file.name : "Choose JSON file..."}
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">
            Duplicate Handling
          </label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="strategy"
                value="skip"
                checked={strategy === "skip"}
                onChange={() => setStrategy("skip")}
                className="accent-brand"
              />
              <span className="text-xs text-text-secondary">Skip existing (keep current)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="strategy"
                value="update"
                checked={strategy === "update"}
                onChange={() => setStrategy("update")}
                className="accent-brand"
              />
              <span className="text-xs text-text-secondary">Update existing (overwrite with imported)</span>
            </label>
          </div>
        </div>

        {result && result.skipped !== -1 && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-text-secondary">
            {result.created} created, {result.updated} updated, {result.skipped} skipped
          </div>
        )}

        {result && result.skipped === -1 && (
          <div className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
            Import failed. Check file format.
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className={btnSecondary + " !px-3 !py-1.5 !text-xs"}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={() => void handleImport()}
              disabled={!file || importing}
              className={btnPrimary + " !px-3 !py-1.5 !text-xs"}
            >
              {importing ? "Importing..." : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
