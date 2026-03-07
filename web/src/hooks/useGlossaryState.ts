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

  return { terms, loading, loadTerms, addTerm, updateTerm, deleteTerm };
}
