import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { api } from "../api";
import type { Task, ReviewComment, LineComment, TaskRunState, GitStatusInfo, ApplyToMainOptions } from "../types";
import type { StreamFunctions } from "./streamTypes";

export function useReviewState({
  selectedTaskId,
  selectedRepoId,
  tasks,
  taskRunStates,
  detailsTab,
  streamRef,
  updateTaskRunState,
  refreshTasks,
  setError, setInfo, setBusy,
  setDetailsTab,
}: {
  selectedTaskId: string;
  selectedRepoId: string;
  tasks: Task[];
  taskRunStates: Record<string, TaskRunState>;
  detailsTab: string;
  streamRef: React.RefObject<StreamFunctions | null>;
  updateTaskRunState: (taskId: string, updater: (current: TaskRunState) => TaskRunState) => void;
  refreshTasks: () => Promise<void>;
  setError: (msg: string) => void;
  setInfo: (msg: string) => void;
  setBusy: (v: boolean) => void;
  setDetailsTab: (v: "plan" | "tasklist" | "run" | "review") => void;
}) {
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [runDiff, setRunDiff] = useState("");
  const [runDiffLoading, setRunDiffLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState<"instant" | "batch">("batch");
  const [batchLineComments, setBatchLineComments] = useState<LineComment[]>([]);
  const [lineSelection, setLineSelection] = useState<{filePath: string; lineStart: number; lineEnd: number; hunk: string; anchorKey: string} | null>(null);
  const [draftText, setDraftText] = useState("");
  const [applyConflicts, setApplyConflicts] = useState<string[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null);
  const [reviewProfileId, setReviewProfileId] = useState("");
  const [carryDirtyState, setCarryDirtyState] = useState(false);

  // Reset review state when task changes
  useEffect(() => {
    if (!selectedTaskId) {
      setReviewComments([]); setRunDiff(""); setBatchLineComments([]);
      setLineSelection(null); setDraftText(""); setGitStatus(null);
      return;
    }
    void (async () => {
      try {
        const payload = await api<{ reviewComments: ReviewComment[] }>(
          `/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews`,
        );
        setReviewComments(payload.reviewComments);
      } catch { /* silent */ }
    })();
  }, [selectedTaskId]);

  // Derive the run ID to fetch diff for
  const diffRunId = useMemo(() => {
    if (detailsTab !== "review" || !selectedTaskId) return null;
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (!task || !["IN_REVIEW", "DONE"].includes(task.status)) return null;
    const trs = taskRunStates[selectedTaskId];
    return trs?.runResult?.run?.id || trs?.activeRun?.id || null;
  }, [detailsTab, selectedTaskId, tasks, taskRunStates]);

  // Fetch run diff only when the run ID actually changes
  const prevDiffRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!diffRunId || diffRunId === prevDiffRunIdRef.current) return;
    prevDiffRunIdRef.current = diffRunId;
    setRunDiffLoading(true);
    api<{ diff: string }>(`/api/runs/${encodeURIComponent(diffRunId)}/diff`)
      .then((res) => setRunDiff(res.diff || ""))
      .catch(() => setRunDiff(""))
      .finally(() => setRunDiffLoading(false));
    api<GitStatusInfo>(`/api/runs/${encodeURIComponent(diffRunId)}/git-status`)
      .then((res) => setGitStatus(res))
      .catch(() => setGitStatus(null));
  }, [diffRunId]);

  const handleLineSelect = useCallback((filePath: string, lineStart: number, lineEnd: number, hunk: string, anchorKey: string) => {
    setLineSelection({ filePath, lineStart, lineEnd, hunk, anchorKey });
    setDraftText("");
  }, []);

  const handleLineCancel = useCallback(() => {
    setLineSelection(null);
    setDraftText("");
  }, []);

  const pollForReviewRun = useCallback((reviewRunId: string) => {
    const poll = async () => {
      for (let i = 0; i < 20; i++) {
        try {
          const runData = await api<{ run: { id: string; status: string } }>(`/api/runs/${reviewRunId}`);
          if (runData.run) { streamRef.current?.attachRunLogStream(reviewRunId, selectedTaskId, selectedRepoId); return; }
        } catch { /* not ready yet */ }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    void poll();
  }, [selectedTaskId, selectedRepoId, streamRef]);

  const submitReview = useCallback(async () => {
    if (!selectedTaskId || !reviewText.trim()) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/review`,
        { method: "POST", body: JSON.stringify({ comment: reviewText.trim(), profileId: reviewProfileId || undefined, carryDirtyState }) },
      );
      setReviewComments((prev) => [...prev, { ...payload.reviewComment, status: "processing", result_run_id: payload.run.id }]);
      setReviewText("");
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [], runFinished: false, runResult: null,
      }));
      setDetailsTab("run");
      pollForReviewRun(reviewRunId);
      setInfo("Review feedback submitted. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, reviewText, reviewProfileId, carryDirtyState, updateTaskRunState, pollForReviewRun, setDetailsTab, setError, setInfo, setBusy]);

  const submitLineReviewInstant = useCallback(async () => {
    if (!selectedTaskId || !lineSelection || !draftText.trim()) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: "instant",
            profileId: reviewProfileId || undefined,
            carryDirtyState,
            lineComments: [{
              filePath: lineSelection.filePath,
              lineStart: lineSelection.lineStart,
              lineEnd: lineSelection.lineEnd,
              diffHunk: lineSelection.hunk,
              text: draftText.trim(),
            }],
          }),
        },
      );
      setReviewComments((prev) => [...prev, { ...payload.reviewComment, status: "processing", result_run_id: payload.run.id }]);
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [], runFinished: false, runResult: null,
      }));
      setDetailsTab("run");
      pollForReviewRun(reviewRunId);
      setInfo("Line review submitted. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, lineSelection, draftText, reviewProfileId, carryDirtyState, updateTaskRunState, pollForReviewRun, setDetailsTab, setError, setInfo, setBusy]);

  const handleLineSave = useCallback(() => {
    if (!lineSelection || !draftText.trim()) return;
    if (reviewMode === "instant") {
      void submitLineReviewInstant();
    } else {
      setBatchLineComments((prev) => [...prev, {
        filePath: lineSelection.filePath,
        lineStart: lineSelection.lineStart,
        lineEnd: lineSelection.lineEnd,
        diffHunk: lineSelection.hunk,
        text: draftText.trim(),
      }]);
    }
    setLineSelection(null);
    setDraftText("");
  }, [lineSelection, draftText, reviewMode, submitLineReviewInstant]);

  const submitBatchReview = useCallback(async () => {
    if (!selectedTaskId || (batchLineComments.length === 0 && !reviewText.trim())) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            comment: reviewText.trim() || undefined,
            mode: "batch",
            profileId: reviewProfileId || undefined,
            carryDirtyState,
            lineComments: batchLineComments,
          }),
        },
      );
      setReviewComments((prev) => [...prev, { ...payload.reviewComment, status: "processing", result_run_id: payload.run.id }]);
      setReviewText("");
      setBatchLineComments([]);
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [], runFinished: false, runResult: null,
      }));
      setDetailsTab("run");
      pollForReviewRun(reviewRunId);
      setInfo("Batch review submitted. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, reviewText, reviewProfileId, carryDirtyState, batchLineComments, updateTaskRunState, pollForReviewRun, setDetailsTab, setError, setInfo, setBusy]);

  const editReviewComment = useCallback(async (commentId: string, newText: string) => {
    if (!selectedTaskId || !newText.trim()) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews/${encodeURIComponent(commentId)}`,
        { method: "PUT", body: JSON.stringify({ comment: newText.trim() }) },
      );
      setReviewComments((prev) => prev.map((rc) => rc.id === commentId ? payload.reviewComment : rc));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, setError, setBusy]);

  const deleteReviewComment = useCallback(async (commentId: string) => {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      await api(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews/${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
      setReviewComments((prev) => prev.filter((rc) => rc.id !== commentId));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, setError, setBusy]);

  const resendReviewComment = useCallback(async (commentId: string) => {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews/${encodeURIComponent(commentId)}/resend`,
        { method: "POST", body: JSON.stringify({ profileId: reviewProfileId || undefined }) },
      );
      setReviewComments((prev) => prev.map((rc) => rc.id === commentId ? { ...payload.reviewComment, status: "processing" as const, result_run_id: payload.run.id } : rc));
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev, activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [], runFinished: false, runResult: null,
      }));
      setDetailsTab("run");
      pollForReviewRun(reviewRunId);
      setInfo("Review re-sent. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, reviewProfileId, updateTaskRunState, pollForReviewRun, setDetailsTab, setError, setInfo, setBusy]);

  const applyToMain = useCallback(async (opts?: ApplyToMainOptions) => {
    if (!selectedTaskId) return;
    setError(""); setInfo(""); setBusy(true); setApplyConflicts([]);
    try {
      const body: Record<string, unknown> = {};
      if (opts?.autoCommit) body.autoCommit = true;
      if (opts?.commitMessage) body.commitMessage = opts.commitMessage;
      if (opts?.strategy) body.strategy = opts.strategy;
      const res = await fetch(`/api/tasks/${encodeURIComponent(selectedTaskId)}/apply-to-main`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict) { setApplyConflicts(data.conflictedFiles ?? []); }
      else if (res.ok && data.applied) {
        setApplyConflicts([]);
        const commitMsg = data.committed ? " and committed" : " as unstaged";
        setInfo(`Changes applied to ${data.baseBranch}${commitMsg} (${data.filesChanged} files). Strategy: ${data.strategy ?? "squash"}`);
      }
      else { setError(data.error ?? "Failed to apply changes."); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, setError, setInfo, setBusy]);

  const pushBranch = useCallback(async () => {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      await api(`/api/tasks/${encodeURIComponent(selectedTaskId)}/push`, { method: "POST" });
      setInfo("Branch pushed to origin.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, setError, setInfo, setBusy]);

  const createPR = useCallback(async () => {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      const data = await api<{ prUrl: string; prNumber: number }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/create-pr`, { method: "POST" });
      setInfo(`PR created: ${data.prUrl}`);
      await refreshTasks();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, refreshTasks, setError, setInfo, setBusy]);

  const markTaskDone = useCallback(async () => {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      await api(`/api/tasks/${encodeURIComponent(selectedTaskId)}/complete`, { method: "POST" });
      await refreshTasks();
      setInfo("Task marked as done.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, refreshTasks, setError, setInfo, setBusy]);

  const resolveConflicts = useCallback(async (mode: 'agent' | 'manual', files: string[]) => {
    if (mode === 'manual') return; // user handles manually
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(selectedTaskId)}/resolve-conflicts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictedFiles: files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start conflict resolution");
      setInfo("Conflict resolution agent started.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selectedTaskId, setError, setInfo, setBusy]);

  return {
    reviewComments, setReviewComments,
    reviewText, setReviewText,
    runDiff, runDiffLoading,
    reviewMode, setReviewMode,
    reviewProfileId, setReviewProfileId,
    carryDirtyState, setCarryDirtyState,
    batchLineComments, setBatchLineComments,
    lineSelection, draftText, setDraftText,
    applyConflicts,
    handleLineSelect, handleLineSave, handleLineCancel,
    submitReview, submitBatchReview,
    editReviewComment, deleteReviewComment, resendReviewComment,
    gitStatus,
    applyToMain, pushBranch, createPR, markTaskDone, resolveConflicts,
  };
}
