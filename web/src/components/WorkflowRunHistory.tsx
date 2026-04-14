import { type FC, useEffect, useState } from 'react';
import type { WorkflowRun, NodeAttempt } from '../types/workflow';
import { workflowApi } from '../api/workflow';

interface Props {
  runs: WorkflowRun[];
  open: boolean;
  onToggle: () => void;
  onRetryNode: (runId: string, nodeId: string) => void;
}

const STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  done:     { fg: 'text-status-success', bg: 'bg-status-success-soft' },
  failed:   { fg: 'text-status-danger',  bg: 'bg-status-danger-soft' },
  running:  { fg: 'text-brand',          bg: 'bg-brand-tint' },
  halted:   { fg: 'text-status-warning', bg: 'bg-status-warning-soft' },
  cancelled:{ fg: 'text-text-muted',     bg: 'bg-surface-200' },
  pending:  { fg: 'text-text-muted',     bg: 'bg-surface-200' },
  skipped:  { fg: 'text-text-muted',     bg: 'bg-surface-200' },
};

const tone = (s: string) => STATUS_TONE[s] ?? STATUS_TONE.pending;

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export const WorkflowRunHistory: FC<Props> = ({ runs, open, onToggle, onRetryNode }) => {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, NodeAttempt[]>>({});

  const expand = async (runId: string) => {
    if (openRunId === runId) { setOpenRunId(null); return; }
    setOpenRunId(runId);
    if (!details[runId]) {
      const { attempts } = await workflowApi.getRun(runId);
      setDetails((d) => ({ ...d, [runId]: attempts }));
    }
  };

  useEffect(() => {
    if (!openRunId) return;
    void workflowApi.getRun(openRunId).then(({ attempts }) =>
      setDetails((d) => ({ ...d, [openRunId]: attempts })),
    );
  }, [runs, openRunId]);

  return (
    <div className="shrink-0 border-t border-border-default bg-surface-100/70 backdrop-blur-md">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted transition hover:text-text-secondary"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Run history
        <span className="ml-1 rounded-full bg-surface-200 px-1.5 py-0 text-[10px] tabular-nums text-text-secondary">
          {runs.length}
        </span>
      </button>

      {open && (
        <div className="max-h-[280px] overflow-auto px-3 pb-3">
          {runs.length === 0 && (
            <div className="rounded-[var(--radius-md)] bg-surface-0/40 px-4 py-6 text-center text-[12px] text-text-muted">
              No runs yet. Hit Run to execute the workflow.
            </div>
          )}

          <div className="space-y-1.5">
            {runs.map((r) => {
              const t = tone(r.status);
              const isOpen = openRunId === r.id;
              return (
                <div
                  key={r.id}
                  className="overflow-hidden rounded-[var(--radius-md)] border border-border-default bg-surface-0/40"
                >
                  <button
                    type="button"
                    onClick={() => void expand(r.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-surface-200/50"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${t.fg.replace('text-', 'bg-')}`}
                    />
                    <span className="font-mono text-[11px] text-text-secondary">
                      {formatDate(r.started_at)} · {formatTime(r.started_at)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${t.bg} ${t.fg}`}>
                      {r.status}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted">
                      {r.trigger}
                    </span>
                    <svg
                      className={`ml-auto h-3 w-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 12 12" fill="none"
                    >
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t border-border-default/60 bg-surface-100/40 px-3 py-2">
                      {Object.entries(groupByNode(details[r.id] ?? [])).map(([nodeId, attempts]) => (
                        <NodeAttempts
                          key={nodeId}
                          nodeId={nodeId}
                          attempts={attempts}
                          onRetry={() => onRetryNode(r.id, nodeId)}
                        />
                      ))}
                      {(details[r.id]?.length ?? 0) === 0 && (
                        <div className="py-2 text-center text-[11px] text-text-muted">
                          Loading…
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const NodeAttempts: FC<{ nodeId: string; attempts: NodeAttempt[]; onRetry: () => void }> = ({ nodeId, attempts, onRetry }) => {
  const latest = attempts[attempts.length - 1];
  const latestTone = latest ? tone(latest.status) : tone('pending');
  return (
    <div className="rounded-[var(--radius-md)] bg-surface-0/50 px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-[11px] font-medium text-text-primary">{nodeId}</span>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider ${latestTone.bg} ${latestTone.fg}`}>
          {latest?.status ?? 'pending'}
        </span>
        {latest?.status === 'failed' && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded-full bg-status-warning-soft px-2 py-0.5 text-[10px] font-medium text-status-warning transition hover:bg-status-warning/20"
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
              <path d="M9.5 5.5A4 4 0 1 1 6 2V1L8 3L6 5V4A3 3 0 1 0 8.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            Retry
          </button>
        )}
      </div>
      {attempts.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {attempts.map((a) => {
            const t = tone(a.status);
            return (
              <span
                key={a.id}
                className={`rounded-full px-1.5 py-0 text-[9px] font-mono ${t.bg} ${t.fg}`}
                title={`Attempt ${a.attempt_num} — ${a.status}${a.duration_ms != null ? ` · ${a.duration_ms}ms` : ''}`}
              >
                #{a.attempt_num}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

function groupByNode(attempts: NodeAttempt[]): Record<string, NodeAttempt[]> {
  const out: Record<string, NodeAttempt[]> = {};
  for (const a of attempts) {
    (out[a.node_id] ??= []).push(a);
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => x.attempt_num - y.attempt_num);
  return out;
}
