import { useState, useCallback } from "react";
import { api } from "../api";

export interface TaskMemory {
  id: string;
  repo_id: string;
  task_id: string;
  run_id: string;
  title: string;
  summary: string;
  files_changed: string[];
  created_at: string;
}

interface MemoriesResponse {
  memories: TaskMemory[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

export function useMemoryState() {
  const [memories, setMemories] = useState<TaskMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadMemories = useCallback(async (repoId: string, query?: string, pageNum = 1) => {
    if (!repoId) { setMemories([]); setTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ repoId, page: String(pageNum), limit: String(PAGE_SIZE) });
      if (query?.trim()) params.set("q", query.trim());
      const res = await api<MemoriesResponse>(`/api/memories?${params}`);
      setMemories(res.memories);
      setTotal(res.total);
      setPage(pageNum);
    } catch {
      setMemories([]);
      setTotal(0);
    }
    setLoading(false);
  }, []);

  const deleteMemory = useCallback(async (id: string, repoId: string, query?: string, pageNum = 1) => {
    await api(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMemories(repoId, query, pageNum);
  }, [loadMemories]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    memories, total, page, totalPages, loading,
    searchQuery, setSearchQuery,
    loadMemories, deleteMemory,
  };
}
