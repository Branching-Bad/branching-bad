import { useState, useCallback } from "react";
import { api } from "../api";

export interface GlossaryTerm {
  id: string;
  repo_id: string;
  term: string;
  description: string;
  created_at: string;
}

export function useGlossaryState() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTerms = useCallback(async (repoId: string) => {
    if (!repoId) return;
    setLoading(true);
    try {
      const res = await api<{ terms: GlossaryTerm[] }>(
        `/api/glossary?repoId=${encodeURIComponent(repoId)}`,
      );
      setTerms(res.terms);
    } finally {
      setLoading(false);
    }
  }, []);

  const addTerm = useCallback(async (repoId: string, term: string, description: string) => {
    await api("/api/glossary", {
      method: "POST",
      body: JSON.stringify({ repoId, term, description }),
    });
    await loadTerms(repoId);
  }, [loadTerms]);

  const updateTerm = useCallback(async (id: string, term: string, description: string, repoId: string) => {
    await api(`/api/glossary/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ term, description }),
    });
    await loadTerms(repoId);
  }, [loadTerms]);

  const deleteTerm = useCallback(async (id: string, repoId: string) => {
    await api(`/api/glossary/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadTerms(repoId);
  }, [loadTerms]);

  const exportTerms = useCallback((repoId: string) => {
    if (!repoId || terms.length === 0) return;
    const payload = {
      type: "glossary",
      version: 1,
      exportedAt: new Date().toISOString(),
      terms: terms.map((t) => ({ term: t.term, description: t.description })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "glossary.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [terms]);

  const importTerms = useCallback(async (
    repoId: string,
    file: File,
    strategy: "skip" | "update",
  ): Promise<{ created: number; updated: number; skipped: number }> => {
    const text = await file.text();
    const data = JSON.parse(text);
    const terms = Array.isArray(data.terms) ? data.terms : Array.isArray(data) ? data : [];
    const res = await api<{ created: number; updated: number; skipped: number }>("/api/glossary/import", {
      method: "POST",
      body: JSON.stringify({ repoId, strategy, terms }),
    });
    await loadTerms(repoId);
    return res;
  }, [loadTerms]);

  return { terms, loading, loadTerms, addTerm, updateTerm, deleteTerm, exportTerms, importTerms };
}
