import { useState, useCallback, useMemo } from "react";
import type { RepositoryRule } from "../types";
import { api } from "../api";

export function useRulesState() {
  const [rules, setRules] = useState<RepositoryRule[]>([]);

  const globalRules = useMemo(() => rules.filter((r) => r.repo_id === null), [rules]);
  const repoRules = useMemo(() => rules.filter((r) => r.repo_id !== null), [rules]);

  const loadRules = useCallback(async (repoId?: string) => {
    try {
      const url = repoId ? `/api/rules?repoId=${encodeURIComponent(repoId)}` : "/api/rules";
      const res = await api<{ rules: RepositoryRule[] }>(url);
      setRules(res.rules);
    } catch {
      setRules([]);
    }
  }, []);

  const addRule = useCallback(async (repoId: string | null, content: string) => {
    const body: Record<string, unknown> = { content };
    if (repoId) body.repoId = repoId;
    await api<{ rule: RepositoryRule }>("/api/rules", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }, []);

  const updateRule = useCallback(async (id: string, content: string) => {
    await api(`/api/rules/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    await api(`/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
  }, []);

  const pinCommentAsRule = useCallback(async (commentId: string, repoId?: string) => {
    const body: Record<string, unknown> = {};
    if (repoId) body.repoId = repoId;
    await api(`/api/rules/from-comment/${encodeURIComponent(commentId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }, []);

  const bulkReplaceRules = useCallback(async (repoId: string | null, contents: string[]) => {
    await api("/api/rules/bulk-replace", {
      method: "POST",
      body: JSON.stringify({ repoId, contents }),
    });
  }, []);

  const optimizeRules = useCallback(async (profileId: string, repoId?: string, instruction?: string, scope?: string) => {
    const body: Record<string, unknown> = { profileId };
    if (repoId) body.repoId = repoId;
    if (instruction?.trim()) body.instruction = instruction.trim();
    if (scope) body.scope = scope;
    const res = await api<{ optimized: string[] }>("/api/rules/optimize", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.optimized;
  }, []);

  return {
    rules,
    globalRules,
    repoRules,
    loadRules,
    addRule,
    updateRule,
    deleteRule,
    pinCommentAsRule,
    bulkReplaceRules,
    optimizeRules,
  };
}
