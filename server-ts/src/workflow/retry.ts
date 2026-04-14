import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../state.js';
import type { ScriptNode, AgentNode } from './model.js';
import { runScriptNode } from './nodeRunner.js';
import { runAgentNode } from './agentAdapter.js';
import { broadcastWorkflow } from '../websocket.js';
import { getAppDataDir } from '../routes/shared.js';

export async function retryNode(state: AppState, runId: string, nodeId: string): Promise<string> {
  const db = state.db;
  const run = db.getWorkflowRun(runId);
  if (!run) throw new Error('run not found');
  if (run.status !== 'failed' && run.status !== 'halted') throw new Error('run not in retryable state');

  const node = run.snapshot.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error('node not found in snapshot');

  const latest = db.getLatestAttempt(runId, nodeId);
  if (!latest || latest.status !== 'failed') throw new Error('latest attempt not in failed state');

  const wf = db.getWorkflow(run.workflow_id);
  const repo = wf ? db.getRepoById(wf.repo_id) : null;
  if (!repo) throw new Error('repo gone');

  const attemptNum = latest.attempt_num + 1;
  const attemptId = randomUUID();
  db.createAttempt({ id: attemptId, runId, nodeId, attemptNum });
  db.updateAttempt(attemptId, { status: 'running', started_at: new Date().toISOString() });
  broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: 'running' });

  // rebuild stdin from latest attempts of parents (those that ran and produced stdout)
  const inEdges = run.snapshot.edges
    .filter((e) => e.to === nodeId)
    .sort((a, b) => a.inputOrder - b.inputOrder);
  const stdinText = inEdges
    .map((e) => db.getLatestAttempt(runId, e.from)?.stdout_inline ?? '')
    .join('');

  const baseDir = getAppDataDir();
  const outputDir = path.join(baseDir, 'workflow_outputs', runId, attemptId);
  const tmpDir = path.join(baseDir, 'workflow_tmp', runId);
  const onStdout = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stdout', nodeId, attemptId, chunk: c.toString('utf8') });
  const onStderr = (c: Buffer) => broadcastWorkflow(runId, { type: 'node.stderr', nodeId, attemptId, chunk: c.toString('utf8') });

  try {
    let exitCode: number;
    let stdoutInline: string | null, stdoutFile: string | null;
    let stderrInline: string | null, stderrFile: string | null;
    let durationMs: number;

    if (node.kind === 'script') {
      const r = await runScriptNode({
        node: node as ScriptNode, stdinText, cwd: repo.path, tmpDir, outputDir,
        onStdout, onStderr,
      });
      exitCode = r.exitCode;
      stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
      stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
      durationMs = r.durationMs;
    } else if (node.kind === 'agent') {
      const r = await runAgentNode({
        node: node as AgentNode, stdinText, repoPath: repo.path,
        outputDir, state, onStdout, onStderr,
      });
      exitCode = r.exitCode;
      stdoutInline = r.stdout.inline; stdoutFile = r.stdout.filePath;
      stderrInline = r.stderr.inline; stderrFile = r.stderr.filePath;
      durationMs = r.durationMs;
    } else {
      // merge: just concat the stdin we already built
      exitCode = 0;
      stdoutInline = stdinText;
      stdoutFile = null;
      stderrInline = null; stderrFile = null;
      durationMs = 0;
    }

    const ended = new Date().toISOString();
    const newStatus: 'done' | 'failed' = exitCode === 0 ? 'done' : 'failed';
    db.updateAttempt(attemptId, {
      status: newStatus, ended_at: ended, exit_code: exitCode, duration_ms: durationMs,
      stdout_inline: stdoutInline, stdout_file: stdoutFile,
      stderr_inline: stderrInline, stderr_file: stderrFile,
    });
    broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: newStatus, endedAt: ended, exitCode });
  } catch (err) {
    db.updateAttempt(attemptId, {
      status: 'failed', ended_at: new Date().toISOString(), stderr_inline: String(err),
    });
    broadcastWorkflow(runId, { type: 'node.state', nodeId, attemptId, status: 'failed' });
  }
  return attemptId;
}
