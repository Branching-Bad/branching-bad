import { useRef, useState } from "react";

export function ImportExportMenu({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const handleExport = async () => {
    const blob = await fetch('/api/ssh/export').then((r) => r.blob());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ssh-export.json'; a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const handleImportFile = async (file: File, strategy: 'skip' | 'update') => {
    const text = await file.text();
    const payload = JSON.parse(text);
    await fetch(`/api/ssh/import?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    onDone();
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md bg-surface-200 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-300 hover:text-text-primary"
      >⋯</button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-surface-100 shadow-[var(--shadow-md)]">
          <button onClick={() => void handleExport()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-200 hover:text-text-primary">Export JSON</button>
          <button onClick={() => fileInput.current?.click()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-surface-200 hover:text-text-primary">Import (skip existing)</button>
          <input ref={fileInput} type="file" accept="application/json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f, 'skip');
              e.target.value = '';
            }} />
        </div>
      )}
    </div>
  );
}
