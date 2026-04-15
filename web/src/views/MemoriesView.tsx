import type { TaskMemory } from "../hooks/useMemoryState";
import { MemoryPanel } from "../components/sections/MemoryPanel";
import { ViewShell } from "./ViewShell";

export function MemoriesView(props: {
  selectedRepoId: string;
  memories: TaskMemory[];
  memoryTotal: number;
  memoryPage: number;
  memoryTotalPages: number;
  memoryLoading: boolean;
  memorySearchQuery: string;
  onMemorySearchChange: (q: string) => void;
  onLoadMemories: (repoId: string, query?: string, page?: number) => Promise<void>;
  onDeleteMemory: (id: string, repoId: string, query?: string, page?: number) => Promise<void>;
  onExportMemories?: (repoId: string) => void;
  onImportMemories?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  return (
    <ViewShell title="Memories" subtitle="Agent-generated summaries from past tasks">
      <MemoryPanel {...props} />
    </ViewShell>
  );
}
