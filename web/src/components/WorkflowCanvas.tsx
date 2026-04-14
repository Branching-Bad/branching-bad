import { type FC, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { Graph, GraphNode, Edge, AttemptStatus } from '../types/workflow';

interface Props {
  graph: Graph;
  liveStatus?: Record<string, AttemptStatus>;
  onGraphChange: (next: Graph) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#64748b',
  running: '#3b82f6',
  done: '#22c55e',
  failed: '#ef4444',
  skipped: '#475569',
  cancelled: '#334155',
};

const NODE_W = 160;
const NODE_H = 60;

export const WorkflowCanvas: FC<Props> = ({ graph, liveStatus, onGraphChange, onSelectNode, onSelectEdge }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);
  const graphRef = useRef<Graph>(graph);
  graphRef.current = graph;

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const root = d3.select(rootRef.current!);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
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

  useEffect(() => {
    const root = d3.select(rootRef.current!);

    // edges
    const edgeSel = root.selectAll<SVGPathElement, Edge>('path.edge').data(graph.edges, (d) => d.id);
    edgeSel.exit().remove();
    const edgeEnter = edgeSel.enter().append('path').attr('class', 'edge').attr('fill', 'none').attr('stroke-width', 2);
    edgeEnter
      .merge(edgeSel as any)
      .attr('stroke', (d) => (d.required ? '#94a3b8' : '#475569'))
      .attr('stroke-dasharray', (d) => (d.required ? '' : '4 4'))
      .style('cursor', 'pointer')
      .attr('d', (d) => {
        const from = graph.nodes.find((n) => n.id === d.from);
        const to = graph.nodes.find((n) => n.id === d.to);
        if (!from || !to) return '';
        const x1 = from.position.x + NODE_W;
        const y1 = from.position.y + NODE_H / 2;
        const x2 = to.position.x;
        const y2 = to.position.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectEdge(d.id);
      });

    // nodes
    const nodeSel = root.selectAll<SVGGElement, GraphNode>('g.node').data(graph.nodes, (d) => d.id);
    nodeSel.exit().remove();
    const ent = nodeSel.enter().append('g').attr('class', 'node').style('cursor', 'move');
    ent.append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8).attr('fill', '#0f172a').attr('stroke', '#1e293b');
    ent.append('text').attr('class', 'label').attr('x', 10).attr('y', 24).attr('fill', '#e2e8f0').attr('font-size', 13);
    ent.append('text').attr('class', 'kind').attr('x', 10).attr('y', 44).attr('fill', '#94a3b8').attr('font-size', 10);
    ent.append('circle').attr('class', 'status').attr('cx', NODE_W - 15).attr('cy', 15).attr('r', 6);

    const merged = ent.merge(nodeSel as any);
    merged
      .attr('transform', (d) => `translate(${d.position.x},${d.position.y})`)
      .attr('data-node-id', (d) => d.id)
      .on('click', (event, d) => {
        event.stopPropagation();
        onSelectNode(d.id);
      });
    merged.select('text.label').text((d) => d.label);
    merged.select('text.kind').text((d) => d.kind);
    merged.select('circle.status').attr('fill', (d) => STATUS_COLOR[(liveStatus?.[d.id] as string) ?? 'pending']);

    merged.call(
      d3
        .drag<SVGGElement, GraphNode>()
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
              const x1 = from.position.x + NODE_W;
              const y1 = from.position.y + NODE_H / 2;
              const x2 = to.position.x;
              const y2 = to.position.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
            });
        })
        .on('end', () => {
          onGraphChange({ ...graphRef.current });
        }) as any,
    );
  }, [graph, liveStatus, onGraphChange, onSelectNode, onSelectEdge]);

  return (
    <svg ref={svgRef} className="w-full h-full" style={{ background: '#1C1C1E' }}>
      <g ref={rootRef} />
    </svg>
  );
};
