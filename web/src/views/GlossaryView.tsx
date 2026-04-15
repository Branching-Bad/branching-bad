import type { GlossaryTerm } from "../hooks/useGlossaryState";
import { GlossaryPanel } from "../components/GlossaryPanel";
import { ViewShell } from "./ViewShell";

export function GlossaryView(props: {
  glossaryTerms: GlossaryTerm[];
  glossaryLoading: boolean;
  selectedRepoId: string;
  onAddGlossaryTerm?: (repoId: string, term: string, description: string) => Promise<void>;
  onUpdateGlossaryTerm?: (id: string, term: string, description: string, repoId: string) => Promise<void>;
  onDeleteGlossaryTerm?: (id: string, repoId: string) => Promise<void>;
  onExportGlossary?: (repoId: string) => void;
  onImportGlossary?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  return (
    <ViewShell title="Glossary" subtitle="Domain terms for this repository">
      <GlossaryPanel
        terms={props.glossaryTerms}
        loading={props.glossaryLoading}
        selectedRepoId={props.selectedRepoId}
        onAdd={props.onAddGlossaryTerm ?? (async () => {})}
        onUpdate={props.onUpdateGlossaryTerm ?? (async () => {})}
        onDelete={props.onDeleteGlossaryTerm ?? (async () => {})}
        onExport={props.onExportGlossary}
        onImport={props.onImportGlossary}
      />
    </ViewShell>
  );
}
