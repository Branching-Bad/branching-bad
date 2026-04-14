import type { Graph, GraphNode, Edge, RunStatus, AttemptStatus } from './model.js';

export interface NodeExecutorInput {
  node: GraphNode;
  stdinText: string;
  parentStdouts: Array<{ nodeId: string; inputOrder: number; stdout: string }>;
}
export interface NodeExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export type NodeExecutor = (input: NodeExecutorInput) => Promise<NodeExecutorResult>;

export interface GraphRunResult {
  status: RunStatus;
  perNode: Record<string, { status: AttemptStatus; stdout: string; stderr: string; exitCode: number | null }>;
}

export async function executeGraph(graph: Graph, exec: NodeExecutor): Promise<GraphRunResult> {
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const n of graph.nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); }
  for (const e of graph.edges) {
    incoming.get(e.to)!.push(e);
    outgoing.get(e.from)!.push(e);
  }

  const status = new Map<string, AttemptStatus>();
  const stdoutByNode = new Map<string, string>();
  const stderrByNode = new Map<string, string>();
  const exitByNode = new Map<string, number | null>();
  for (const n of graph.nodes) status.set(n.id, 'pending');

  let halted = false;

  const isReady = (id: string): boolean => {
    if (status.get(id) !== 'pending') return false;
    for (const e of incoming.get(id) ?? []) {
      const s = status.get(e.from);
      if (s === 'pending' || s === 'running') return false;
      if (e.required && s !== 'done') return false;
    }
    return true;
  };

  const shouldSkip = (id: string): boolean => {
    const edges = incoming.get(id) ?? [];
    // If any parent is still pending/running, can't determine skip yet
    if (edges.some((e) => { const s = status.get(e.from); return s === 'pending' || s === 'running'; })) {
      return false;
    }
    for (const e of edges) {
      if (e.required && status.get(e.from) !== 'done') return true;
    }
    return false;
  };

  const buildStdin = (id: string): string => {
    const inEdges = [...(incoming.get(id) ?? [])].sort((a, b) => a.inputOrder - b.inputOrder);
    return inEdges.map((e) => stdoutByNode.get(e.from) ?? '').join('');
  };

  const terminal = (s: AttemptStatus) =>
    s === 'done' || s === 'failed' || s === 'skipped' || s === 'cancelled';
  const allTerminal = () => graph.nodes.every((n) => terminal(status.get(n.id)!));

  const propagateSkip = (startId: string) => {
    const queue = [startId];
    while (queue.length) {
      const u = queue.shift()!;
      for (const e of outgoing.get(u) ?? []) {
        const child = e.to;
        if (status.get(child) !== 'pending') continue;
        // Only skip if ALL required-edge parents are definitively non-done
        // and no parent is still running/pending (which would resolve later)
        const childEdges = incoming.get(child) ?? [];
        const hasBlockingRequired = childEdges.some(
          (ce) => ce.required && status.get(ce.from) !== 'done' &&
                  status.get(ce.from) !== 'pending' && status.get(ce.from) !== 'running',
        );
        const stillWaiting = childEdges.some(
          (ce) => status.get(ce.from) === 'pending' || status.get(ce.from) === 'running',
        );
        if (hasBlockingRequired && !stillWaiting) {
          status.set(child, 'skipped');
          queue.push(child);
        }
      }
    }
  };

  const haltEverything = () => {
    halted = true;
    for (const n of graph.nodes) {
      const s = status.get(n.id)!;
      if (s === 'pending' || s === 'running') status.set(n.id, 'cancelled');
    }
  };

  while (!allTerminal()) {
    if (halted) break;
    const ready = graph.nodes.filter((n) => isReady(n.id));
    if (ready.length === 0) {
      for (const n of graph.nodes) {
        if (status.get(n.id) === 'pending' && shouldSkip(n.id)) {
          status.set(n.id, 'skipped');
          propagateSkip(n.id);
        }
      }
      if (allTerminal()) break;
      if (!graph.nodes.some((n) => isReady(n.id))) break;
      continue;
    }

    for (const n of ready) status.set(n.id, 'running');
    await Promise.all(ready.map(async (n) => {
      const stdin = buildStdin(n.id);
      const parentStdouts = (incoming.get(n.id) ?? []).map((e) => ({
        nodeId: e.from, inputOrder: e.inputOrder, stdout: stdoutByNode.get(e.from) ?? '',
      }));
      try {
        const r = await exec({ node: n, stdinText: stdin, parentStdouts });
        // If halted while we were running, leave the cancelled status set by haltEverything
        if (halted && status.get(n.id) === 'cancelled') return;
        stdoutByNode.set(n.id, r.stdout);
        stderrByNode.set(n.id, r.stderr);
        exitByNode.set(n.id, r.exitCode);
        if (r.exitCode === 0) {
          status.set(n.id, 'done');
        } else {
          status.set(n.id, 'failed');
          if (n.onFail === 'halt-all') { haltEverything(); return; }
          propagateSkip(n.id);
        }
      } catch (err) {
        if (halted && status.get(n.id) === 'cancelled') return;
        status.set(n.id, 'failed');
        stderrByNode.set(n.id, String(err));
        exitByNode.set(n.id, -1);
        if (n.onFail === 'halt-all') { haltEverything(); return; }
        propagateSkip(n.id);
      }
    }));
  }

  const anyFailed = graph.nodes.some((n) => status.get(n.id) === 'failed');
  const runStatus: RunStatus = halted ? 'halted' : (anyFailed ? 'failed' : 'done');

  const perNode: GraphRunResult['perNode'] = {};
  for (const n of graph.nodes) {
    perNode[n.id] = {
      status: status.get(n.id)!,
      stdout: stdoutByNode.get(n.id) ?? '',
      stderr: stderrByNode.get(n.id) ?? '',
      exitCode: exitByNode.get(n.id) ?? null,
    };
  }
  return { status: runStatus, perNode };
}
