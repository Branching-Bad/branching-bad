import { useState } from "react";
import type { GlossaryTerm } from "../hooks/useGlossaryState";
import { ImportDialog } from "./ImportDialog";
import { IconX } from "./icons";
import { inputClass, btnPrimary, btnSecondary } from "./shared";

export function GlossaryPanel({
  terms,
  loading,
  selectedRepoId,
  onAdd,
  onUpdate,
  onDelete,
  onExport,
  onImport,
}: {
  terms: GlossaryTerm[];
  loading: boolean;
  selectedRepoId: string;
  onAdd: (repoId: string, term: string, description: string) => Promise<void>;
  onUpdate: (id: string, term: string, description: string, repoId: string) => Promise<void>;
  onDelete: (id: string, repoId: string) => Promise<void>;
  onExport?: (repoId: string) => void;
  onImport?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  const [newTerm, setNewTerm] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTerm, setEditTerm] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const handleAdd = async () => {
    if (!newTerm.trim() || !newDesc.trim() || !selectedRepoId) return;
    await onAdd(selectedRepoId, newTerm.trim(), newDesc.trim());
    setNewTerm("");
    setNewDesc("");
  };

  const startEdit = (t: GlossaryTerm) => {
    setEditingId(t.id);
    setEditTerm(t.term);
    setEditDesc(t.description);
  };

  const handleUpdate = async () => {
    if (!editingId || !editTerm.trim() || !editDesc.trim()) return;
    await onUpdate(editingId, editTerm.trim(), editDesc.trim(), selectedRepoId);
    setEditingId(null);
  };

  if (!selectedRepoId) {
    return <p className="text-[11px] text-text-muted italic">Select a repository to manage glossary.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-text-muted uppercase tracking-wider">Add Term</label>
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Term — e.g. Payment Settings"
            className={`${inputClass} !py-1.5 !text-xs`}
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description — e.g. Multinet, EFT POS, credit card, Sodexo integrations"
            rows={2}
            className={`${inputClass} !py-1.5 !text-xs resize-none`}
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!newTerm.trim() || !newDesc.trim() || loading}
            className={`${btnPrimary} self-start !px-3 !py-1.5 !text-[11px]`}
          >
            Add
          </button>
        </div>
      </div>

      {(onExport || onImport) && (
        <div className="flex gap-2">
          {onExport && (
            <button
              onClick={() => onExport(selectedRepoId)}
              disabled={terms.length === 0}
              className={`${btnSecondary} !px-3 !py-1.5 !text-[11px]`}
            >
              Export JSON
            </button>
          )}
          {onImport && (
            <button
              onClick={() => setImportOpen(true)}
              className={`${btnSecondary} !px-3 !py-1.5 !text-[11px]`}
            >
              Import JSON
            </button>
          )}
        </div>
      )}

      {onImport && (
        <ImportDialog
          open={importOpen}
          title="Import Glossary"
          onClose={() => setImportOpen(false)}
          onImport={(file, strategy) => onImport(selectedRepoId, file, strategy)}
        />
      )}

      {loading && <p className="text-[11px] text-text-muted">Loading...</p>}

      {!loading && terms.length === 0 && (
        <p className="text-[11px] text-text-muted italic">No glossary terms yet. Add terms to help the analyst and planner understand your domain.</p>
      )}

      <div className="space-y-2">
        {terms.map((t) => (
          <div key={t.id} className="group rounded-lg border border-border-default bg-surface-200 px-3 py-2.5 space-y-1">
            {editingId === t.id ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={editTerm}
                  onChange={(e) => setEditTerm(e.target.value)}
                  className={`${inputClass} !py-1 !text-xs`}
                />
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={2}
                  className={`${inputClass} !py-1 !text-xs resize-none`}
                />
                <div className="flex gap-1.5">
                  <button onClick={() => void handleUpdate()} className={`${btnPrimary} !px-2.5 !py-1 !text-[10px]`}>Save</button>
                  <button onClick={() => setEditingId(null)} className="rounded-md bg-surface-300 px-2.5 py-1 text-[10px] text-text-muted hover:text-text-primary">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h5
                    className="text-xs font-medium text-text-primary leading-snug cursor-pointer hover:text-brand"
                    onClick={() => startEdit(t)}
                    title="Click to edit"
                  >
                    {t.term}
                  </h5>
                  <button
                    onClick={() => void onDelete(t.id, selectedRepoId)}
                    className="shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                    title="Delete term"
                  >
                    <IconX className="h-3 w-3" />
                  </button>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">{t.description}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
