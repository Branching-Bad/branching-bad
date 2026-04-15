import { type FC, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Graph, GraphNode, Edge, AttemptStatus } from '../types/workflow';

interface Props {
  graph: Graph;
  liveStatus?: Record<string, AttemptStatus>;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onGraphChange: (next: Graph) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}

/** Apple systemColor palette, dark. */
const STATUS_COLOR: Record<AttemptStatus, string> = {
  pending: 'rgba(235, 235, 245, 0.3)',
  running: '#FD9201',
  done: '#30D158',
  failed: '#FF453A',
  skipped: 'rgba(235, 235, 245, 0.18)',
  cancelled: 'rgba(235, 235, 245, 0.18)',
};

const KIND_GLYPH: Record<GraphNode['kind'], string> = {
  script: '‹›',
  agent: '◆',
  merge: '⑂',
};

const NODE_W = 196;
const NODE_H = 76;
const RX = 12;

function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.position.x + NODE_W;
  const y1 = from.position.y + NODE_H / 2;
  const x2 = to.position.x;
  const y2 = to.position.y + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export const WorkflowCanvas: FC<Props> = ({
  graph, liveStatus, selectedNodeId, selectedEdgeId,
  onGraphChange, onSelectNode, onSelectEdge,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);
  const graphRef = useRef<Graph>(graph);
  graphRef.current = graph;

  // Pan + zoom, with click-through to clear selection on empty canvas
  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const root = d3.select(rootRef.current!);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .filter((event) => {
        const t = event.target as Element;
        return !t.closest('g.node') && !t.closest('path.edge');
      })
      .on('zoom', (event) => {
        root.attr('transform', event.transform.toString());
      });
    svg.call(zoom as any);
    svg.on('click', (event) => {
      const t = event.target as Element;
      if (!t.closest('g.node') && !t.closest('path.edge')) {
        onSelectNode(null);
        onSelectEdge(null);
      }
    });
  }, [onSelectNode, onSelectEdge]);

  // Render edges + nodes
  useEffect(() => {
    const root = d3.select(rootRef.current!);

    // ── Edges ────────────────────────────────────────────
    const edgeSel = root
      .selectAll<SVGPathElement, Edge>('path.edge')
      .data(graph.edges, (d) => d.id);
    edgeSel.exit().remove();
    const edgeEnter = edgeSel
      .enter()
      .append('path')
      .attr('class', 'edge')
      .attr('fill', 'none');
    edgeEnter
      .merge(edgeSel as any)
      .attr('stroke', (d) =>
        d.id === selectedEdgeId
          ? '#FD9201'
          : d.required
          ? 'rgba(235, 235, 245, 0.45)'
          : 'rgba(235, 235, 245, 0.22)',
      )
      .attr('stroke-width', (d) => (d.id === selectedEdgeId ? 2.5 : 1.75))
      .attr('stroke-dasharray', (d) => (d.required ? '' : '4 4'))
      .style('cursor', 'pointer')
      .attr('d', (d) => {
        const from = graph.nodes.find((n) => n.id === d.from);
        const to = graph.nodes.find((n) => n.id === d.to);
        if (!from || !to) return '';
        return edgePath(from, to);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectEdge(d.id);
      });

    // Arrowheads at the end of each edge
    const arrowSel = root
      .selectAll<SVGPolygonElement, Edge>('polygon.edge-arrow')
      .data(graph.edges, (d) => d.id);
    arrowSel.exit().remove();
    arrowSel
      .enter()
      .append('polygon')
      .attr('class', 'edge-arrow')
      .attr('points', '0,-3.5 6,0 0,3.5')
      .merge(arrowSel as any)
      .attr('fill', (d) =>
        d.id === selectedEdgeId
          ? '#FD9201'
          : d.required
          ? 'rgba(235, 235, 245, 0.45)'
          : 'rgba(235, 235, 245, 0.22)',
      )
      .attr('transform', (d) => {
        const to = graph.nodes.find((n) => n.id === d.to);
        if (!to) return '';
        return `translate(${to.position.x - 2}, ${to.position.y + NODE_H / 2})`;
      });

    // Input order badges at target end (visible when target has 2+ inputs)
    const incomingCountByNode = new Map<string, number>();
    for (const e of graph.edges) {
      incomingCountByNode.set(e.to, (incomingCountByNode.get(e.to) ?? 0) + 1);
    }
    const badgeEdges = graph.edges.filter((e) => (incomingCountByNode.get(e.to) ?? 0) >= 2);

    const orderGroupSel = root
      .selectAll<SVGGElement, Edge>('g.edge-order')
      .data(badgeEdges, (d) => d.id);
    orderGroupSel.exit().remove();
    const orderEnter = orderGroupSel.enter().append('g').attr('class', 'edge-order').style('pointer-events', 'none');
    orderEnter.append('circle').attr('r', 8).attr('fill', '#FD9201').attr('stroke', '#1C1C1E').attr('stroke-width', 1.5);
    orderEnter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#FFFFFF')
      .attr('font-size', 9)
      .attr('font-weight', 700);

    const orderMerged = orderEnter.merge(orderGroupSel as any);
    orderMerged
      .attr('transform', (d) => {
        const to = graph.nodes.find((n) => n.id === d.to);
        if (!to) return '';
        // place just to the left of the target input anchor
        return `translate(${to.position.x - 14}, ${to.position.y + NODE_H / 2})`;
      });
    orderMerged.select('text').text((d) => String(d.inputOrder));

    // ── Nodes ────────────────────────────────────────────
    const nodeSel = root
      .selectAll<SVGGElement, GraphNode>('g.node')
      .data(graph.nodes, (d) => d.id);
    nodeSel.exit().remove();

    const ent = nodeSel
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'grab');

    // glow halo for selection (sits behind the main rect)
    ent
      .append('rect')
      .attr('class', 'halo')
      .attr('x', -3)
      .attr('y', -3)
      .attr('width', NODE_W + 6)
      .attr('height', NODE_H + 6)
      .attr('rx', RX + 3)
      .attr('fill', 'none')
      .attr('stroke', '#FD9201')
      .attr('stroke-width', 2)
      .attr('opacity', 0);

    // main rect
    ent
      .append('rect')
      .attr('class', 'bg')
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', RX)
      .attr('fill', '#2C2C2E') /* surface-200 */
      .attr('stroke', 'rgba(84, 84, 88, 0.65)')
      .attr('stroke-width', 1);

    // top-left kind glyph pill
    ent
      .append('rect')
      .attr('class', 'kind-pill')
      .attr('x', 12)
      .attr('y', 12)
      .attr('width', 26)
      .attr('height', 20)
      .attr('rx', 6)
      .attr('fill', 'rgba(253, 146, 1, 0.12)');
    ent
      .append('text')
      .attr('class', 'kind-glyph')
      .attr('x', 12 + 13)
      .attr('y', 26)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#FD9201')
      .attr('font-size', 11)
      .attr('font-weight', 600);

    // label (node.label) — primary text line
    ent
      .append('text')
      .attr('class', 'label')
      .attr('x', 48)
      .attr('y', 28)
      .attr('fill', '#FFFFFF')
      .attr('font-size', 14)
      .attr('font-weight', 600)
      .attr('font-family',
        '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif');

    // kind name — secondary line
    ent
      .append('text')
      .attr('class', 'kind-text')
      .attr('x', 48)
      .attr('y', 48)
      .attr('fill', 'rgba(235, 235, 245, 0.6)')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('letter-spacing', '0.02em');

    // status dot, top-right
    ent
      .append('circle')
      .attr('class', 'status-dot')
      .attr('cx', NODE_W - 14)
      .attr('cy', 18)
      .attr('r', 4);

    // input anchor
    ent
      .append('circle')
      .attr('class', 'anchor-in')
      .attr('cx', 0)
      .attr('cy', NODE_H / 2)
      .attr('r', 5)
      .attr('fill', '#1C1C1E')
      .attr('stroke', 'rgba(235, 235, 245, 0.45)')
      .attr('stroke-width', 1.5);

    // output anchor
    ent
      .append('circle')
      .attr('class', 'anchor-out')
      .attr('cx', NODE_W)
      .attr('cy', NODE_H / 2)
      .attr('r', 5)
      .attr('fill', '#1C1C1E')
      .attr('stroke', 'rgba(235, 235, 245, 0.45)')
      .attr('stroke-width', 1.5)
      .style('cursor', 'crosshair');

    // ── Merge ────────────────────────────────────────────
    const merged = ent.merge(nodeSel as any);
    merged
      .attr('transform', (d) => `translate(${d.position.x},${d.position.y})`)
      .attr('data-node-id', (d) => d.id)
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectNode(d.id);
      });
    merged.select('text.label').text((d) => d.label || '(untitled)');
    merged.select('text.kind-text').text((d) => d.kind);
    merged.select('text.kind-glyph').text((d) => KIND_GLYPH[d.kind]);
    merged.select('circle.status-dot').attr('fill', (d) =>
      STATUS_COLOR[(liveStatus?.[d.id] as AttemptStatus) ?? 'pending'],
    );
    merged.select('rect.halo').attr('opacity', (d) => (d.id === selectedNodeId ? 0.8 : 0));
    merged
      .select('rect.bg')
      .attr('stroke', (d) =>
        d.id === selectedNodeId ? '#FD9201' : 'rgba(84, 84, 88, 0.65)',
      )
      .attr('stroke-width', (d) => (d.id === selectedNodeId ? 1.5 : 1));

    // node drag (move)
    merged.call(
      d3
        .drag<SVGGElement, GraphNode>()
        .filter((event) => {
          const t = event.target as Element;
          return !t.classList.contains('anchor-out') && !t.classList.contains('anchor-in');
        })
        .on('start', function () {
          d3.select(this).style('cursor', 'grabbing');
        })
        .on('drag', function (event, d) {
          d.position.x += event.dx;
          d.position.y += event.dy;
          d3.select(this).attr('transform', `translate(${d.position.x},${d.position.y})`);
          d3.select(rootRef.current!)
            .selectAll<SVGPathElement, Edge>('path.edge')
            .filter((e) => e.from === d.id || e.to === d.id)
            .attr('d', (e) => {
              const from = graphRef.current.nodes.find((n) => n.id === e.from);
              const to = graphRef.current.nodes.find((n) => n.id === e.to);
              if (!from || !to) return '';
              return edgePath(from, to);
            });
          d3.select(rootRef.current!)
            .selectAll<SVGPolygonElement, Edge>('polygon.edge-arrow')
            .filter((e) => e.from === d.id || e.to === d.id)
            .attr('transform', (e) => {
              const to = graphRef.current.nodes.find((n) => n.id === e.to);
              if (!to) return '';
              return `translate(${to.position.x - 2}, ${to.position.y + NODE_H / 2})`;
            });
        })
        .on('end', function () {
          d3.select(this).style('cursor', 'grab');
          onGraphChange({ ...graphRef.current });
        }) as any,
    );

    // anchor-out drag (edge creation)
    merged.select<SVGCircleElement>('circle.anchor-out').each(function (d) {
      d3.select(this).call(
        d3
          .drag<SVGCircleElement, GraphNode>()
          .on('start', (event) => {
            event.sourceEvent.stopPropagation();
            const [x, y] = d3.pointer(event, rootRef.current!);
            d3.select(rootRef.current!)
              .append('path')
              .attr('class', 'temp-edge')
              .attr('stroke', '#FD9201')
              .attr('stroke-dasharray', '4 4')
              .attr('stroke-width', 2)
              .attr('fill', 'none')
              .attr('d', `M${d.position.x + NODE_W},${d.position.y + NODE_H / 2} L${x},${y}`);
          })
          .on('drag', (event, d) => {
            const [x, y] = d3.pointer(event, rootRef.current!);
            const sx = d.position.x + NODE_W;
            const sy = d.position.y + NODE_H / 2;
            const mx = (sx + x) / 2;
            d3.select(rootRef.current!)
              .select('path.temp-edge')
              .attr('d', `M${sx},${sy} C${mx},${sy} ${mx},${y} ${x},${y}`);
          })
          .on('end', (event) => {
            d3.select(rootRef.current!).select('path.temp-edge').remove();
            const hit = document.elementFromPoint(event.sourceEvent.clientX, event.sourceEvent.clientY);
            const toId = hit?.closest('g.node')?.getAttribute('data-node-id') ?? null;
            if (!toId || toId === d.id) return;
            const current = graphRef.current;
            const ordersOnTarget = current.edges
              .filter((e) => e.to === toId)
              .map((e) => e.inputOrder);
            const inputOrder = ordersOnTarget.length ? Math.max(...ordersOnTarget) + 1 : 1;
            const next: Graph = {
              ...current,
              edges: [
                ...current.edges,
                { id: crypto.randomUUID(), from: d.id, to: toId, required: true, inputOrder },
              ],
            };
            onGraphChange(next);
          }) as any,
      );
    });
  }, [graph, liveStatus, selectedNodeId, selectedEdgeId, onGraphChange, onSelectNode, onSelectEdge]);

  const empty = graph.nodes.length === 0;

  return (
    <div className="relative h-full w-full bg-surface-100">
      {/* Dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <svg ref={svgRef} className="relative h-full w-full">
        <g ref={rootRef} />
      </svg>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-[var(--radius-lg)] border border-border-default bg-surface-100/70 px-6 py-5 text-center text-sm text-text-secondary backdrop-blur-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-text-muted">
              Empty workflow
            </div>
            Add a node from the toolbar above to get started
          </div>
        </div>
      )}
    </div>
  );
};
