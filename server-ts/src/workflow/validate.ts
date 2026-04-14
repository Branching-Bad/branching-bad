import type { Graph } from './model.js';

export function validateGraph(g: Graph): string[] {
  const errors: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));

  for (const e of g.edges) {
    if (!ids.has(e.from)) errors.push(`edge ${e.id}: unknown from=${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id}: unknown to=${e.to}`);
  }

  const seen = new Map<string, string>();
  for (const e of g.edges) {
    const k = `${e.to}:${e.inputOrder}`;
    if (seen.has(k)) errors.push(`duplicate inputOrder ${e.inputOrder} on target ${e.to}`);
    seen.set(k, e.id);
  }

  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) adj.get(e.from)?.push(e.to);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of g.nodes) color.set(n.id, WHITE);
  let cycle = false;
  const visit = (u: string): void => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) { cycle = true; return; }
      if (c === WHITE) { visit(v); if (cycle) return; }
    }
    color.set(u, BLACK);
  };
  for (const n of g.nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
    if (cycle) break;
  }
  if (cycle) errors.push('graph contains a cycle');

  for (const n of g.nodes) {
    if (n.kind === 'script') {
      if (n.lang === 'custom' && !n.runCommand) {
        errors.push(`node ${n.id}: custom lang requires runCommand`);
      }
      if (n.source === 'inline' && !n.code) {
        errors.push(`node ${n.id}: inline source requires code`);
      }
      if (n.source === 'file' && !n.filePath) {
        errors.push(`node ${n.id}: file source requires filePath`);
      }
    }
    if (n.kind === 'agent') {
      if (!n.agentProfileId) errors.push(`node ${n.id}: agentProfileId required`);
      if (!n.promptTemplate) errors.push(`node ${n.id}: promptTemplate required`);
    }
  }

  return errors;
}
