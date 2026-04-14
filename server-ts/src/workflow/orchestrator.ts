import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../state.js';
import type { Graph, ScriptNode, AgentNode } from './model.js';
import { executeGraph, type NodeExecutor } from './runner.js';
import { runScriptNode } from './nodeRunner.js';
import { runAgentNode } from './agentAdapter.js';
import { broadcastWorkflow } from '../websocket.js';
import { getAppDataDir } from '../routes/shared.js';

export interface StartRunOptions {
  workflowId: string;
  trigger: 'manual' | 'cron';
}

export async function startWorkflowRun(state: AppState, opts: StartRunOptions): Promise<string> {
  const db = state.db;
  const wf = db.getWorkflow(opts.workflowId);
  if (!wf) throw new Error(`workflow ${opts.workflowId} not found`);
  const repo = db.getRepoById(wf.repo_id);
  if (!repo) throw new Error(`repo ${wf.repo_id} not found`);

  const runId = randomUUID();
  const snapshot: Graph = JSON.parse(JSON.stringify(wf.graph));
  db.createWorkflowRun(runId, wf.id, opts.trigger, snapshot);

  const attemptIdByNode = new Map<string, string>();
  for (const n of snapshot.nodes) {
    const aid = randomUUID();
    db.createAttempt({ id: aid, runId, nodeId: n.id, attemptNum: 1 });
    attemptIdByNode.set(n.id, aid);
    broadcastWorkflow(runId, { type: 'node.state', nodeId: n.id, attemptId: aid, status: 'pending' });
  }
  broadcastWorkflow(runId, { type: 'run.state', status: 'running' });

  const baseDir = getAppDataDir();
  const outputDir = path.join(baseDir, 'workflow_outputs', runId);
  const tmpDir = path.join(baseDir, 'workflow_tmp', runId);

  const exec: NodeExecutor = async ({ node, stdinText, parentStdouts }) => {
    const attemptId = attemptIdByNode.get(node.id)!;
    const started = new Date().toISOString();
    db.updateAttempt(attemptId, { status: 'running', started_at: started });
    broadcastWorkflow(runId, { type: 'node.state', nodeId: node.id, attemptId, status: 'running', startedAt: started });

    const onStdout = (c: Buffer) =>
      broadcastWorkflow(runId, { type: 'node.stdout', nodeId: node.id, attemptId, chunk: c.toString('utf8') });
    const onStderr = (c: Buffer) =>
      broadcastWorkflow(runId, { type: 'node.stderr', nodeId: node.id, attemptId, chunk: c.toString('utf8') });

    try {
      let exitCode: number;
      let stdoutInline: string | null, stdoutFile: string | null;
      let stderrInline: string | null, stderrFile: string | null;
      let durationMs: number;

      if (node.kind === 'script') {
        const r = await runScriptNode({
          node: node as ScriptNode,
          stdinText,
          cwd: repo.path,
          tmpDir,
          outputDir: path.join(outputDir, attemptId),
          onStdout,
          onStderr,
        });
        exitCode = r.exitCode;
        stdoutInline = r.stdout.inline;
        stdoutFile = r.stdout.filePath;
        stderrInline = r.stderr.inline;
        stderrFile = r.stderr.filePath;
        durationMs = r.durationMs;
      } else if (node.kind === 'agent') {
        const r = await runAgentNode({
          node: node as AgentNode,
          stdinText,
          repoPath: repo.path,
          outputDir: path.join(outputDir, attemptId),
          state,
          onStdout,
          onStderr,
        });
        exitCode = r.exitCode;
        stdoutInline = r.stdout.inline;
        stdoutFile = r.stdout.filePath;
        stderrInline = r.stderr.inline;
        stderrFile = r.stderr.filePath;
        durationMs = r.durationMs;
      } else {
        // merge: concat parent stdouts in inputOrder
        const full = [...parentStdouts]
          .sort((a, b) => a.inputOrder - b.inputOrder)
          .map((p) => p.stdout)
          .join('');
        exitCode = 0;
        stdoutInline = full.length > 1024 * 1024 ? full.slice(0, 1024 * 1024) : full;
        stdoutFile = null;
        stderrInline = null;
        stderrFile = null;
        durationMs = 0;
        if (stdoutInline) onStdout(Buffer.from(stdoutInline));
      }

      const ended = new Date().toISOString();
      const newStatus: 'done' | 'failed' = exitCode === 0 ? 'done' : 'failed';
      db.updateAttempt(attemptId, {
        status: newStatus,
        ended_at: ended,
        exit_code: exitCode,
        duration_ms: durationMs,
        stdout_inline: stdoutInline,
        stdout_file: stdoutFile,
        stderr_inline: stderrInline,
        stderr_file: stderrFile,
      });
      broadcastWorkflow(runId, {
        type: 'node.state',
        nodeId: node.id,
        attemptId,
        status: newStatus,
        endedAt: ended,
        exitCode,
      });
      return { exitCode, stdout: stdoutInline ?? '', stderr: stderrInline ?? '' };
    } catch (err) {
      const ended = new Date().toISOString();
      db.updateAttempt(attemptId, { status: 'failed', ended_at: ended, stderr_inline: String(err) });
      broadcastWorkflow(runId, { type: 'node.state', nodeId: node.id, attemptId, status: 'failed', endedAt: ended });
      return { exitCode: -1, stdout: '', stderr: String(err) };
    }
  };

  executeGraph(snapshot, exec)
    .then(async (res) => {
      for (const n of snapshot.nodes) {
        const per = res.perNode[n.id];
        if (per.status === 'skipped' || per.status === 'cancelled') {
          const aid = attemptIdByNode.get(n.id)!;
          db.updateAttempt(aid, { status: per.status });
          broadcastWorkflow(runId, { type: 'node.state', nodeId: n.id, attemptId: aid, status: per.status });
        }
      }
      const ended = new Date().toISOString();
      db.updateWorkflowRunStatus(runId, res.status, ended);
      broadcastWorkflow(runId, { type: 'run.state', status: res.status, endedAt: ended });
    })
    .catch((err) => {
      const ended = new Date().toISOString();
      db.updateWorkflowRunStatus(runId, 'failed', ended);
      broadcastWorkflow(runId, { type: 'run.state', status: 'failed', endedAt: ended, error: String(err) });
    });

  return runId;
}
