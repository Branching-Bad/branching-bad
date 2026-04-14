import { type FC, useEffect, useState } from 'react';
import type { WorkflowRun, NodeAttempt } from '../types/workflow';
import { workflowApi } from '../api/workflow';

interface Props {
  runs: WorkflowRun[];
  onRetryNode: (runId: string, nodeId: string) => void;
}

export const WorkflowRunHistory: FC<Props> = ({ runs, onRetryNode }) => {
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

  // Refresh details for the open run whenever `runs` updates
  useEffect(() => {
    if (!openRunId) return;
    workflowApi.getRun(openRunId).then(({ attempts }) =>
      setDetails((d) => ({ ...d, [openRunId]: attempts })),
    );
  }, [runs, openRunId]);

  return (
    <div className="border-t border-border-default max-h-72 overflow-auto text-sm">
      {runs.length === 0 && (
        <div className="p-3 text-text-muted text-xs">No runs yet.</div>
      )}
      {runs.map((r) => (
        <div key={r.id} className="border-b border-border-default">
          <button
            className="w-full px-3 py-2 text-left flex justify-between items-center hover:bg-surface-200"
            onClick={() => void expand(r.id)}
          >
            <span className="font-mono text-xs">{r.started_at}</span>
            <span className="text-xs text-text-secondary">
              <StatusBadge status={r.status} /> · {r.trigger}
            </span>
          </button>
          {openRunId === r.id && (
            <div className="bg-surface-200 px-4 py-2 text-xs space-y-1">
              {Object.entries(groupByNode(details[r.id] ?? [])).map(([nodeId, attempts]) => (
                <div key={nodeId} className="py-1">
                  <div className="text-text-secondary font-semibold">{nodeId}</div>
                  {attempts.map((a) => (
                    <AttemptRow
                      key={a.id}
                      attempt={a}
                      canRetry={isLatestFailed(attempts, a)}
                      onRetry={() => onRetryNode(r.id, a.node_id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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

function isLatestFailed(attemptsForNode: NodeAttempt[], a: NodeAttempt): boolean {
  const latest = attemptsForNode[attemptsForNode.length - 1];
  return latest.id === a.id && latest.status === 'failed';
}

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const color =
    status === 'done' ? 'text-status-success'
    : status === 'failed' ? 'text-status-danger'
    : status === 'running' ? 'text-brand'
    : status === 'halted' ? 'text-status-warning'
    : 'text-text-muted';
  return <span className={`${color} font-mono`}>{status}</span>;
};

const AttemptRow: FC<{ attempt: NodeAttempt; canRetry: boolean; onRetry: () => void }> = ({
  attempt,
  canRetry,
  onRetry,
}) => (
  <div className="flex items-center gap-3 pl-3 py-0.5 text-text-secondary">
    <span className="w-8 font-mono">#{attempt.attempt_num}</span>
    <span className="w-20"><StatusBadge status={attempt.status} /></span>
    <span className="w-24 font-mono">
      {attempt.duration_ms != null ? `${attempt.duration_ms}ms` : '—'}
    </span>
    <span className="w-16 font-mono">{attempt.exit_code ?? '—'}</span>
    {canRetry && (
      <button
        className="ml-auto bg-status-warning/80 hover:bg-status-warning text-white px-2 py-0.5 rounded text-xs"
        onClick={onRetry}
      >
        Retry
      </button>
    )}
  </div>
);
