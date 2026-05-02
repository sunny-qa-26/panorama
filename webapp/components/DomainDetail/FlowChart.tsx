'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap
} from 'reactflow';
import 'reactflow/dist/style.css';
import { PanoramaNode } from './PanoramaNode';
import type { FlowGraph, FlowNode, FlowKind } from '@/lib/flow';

const PER_LANE_CAP = 12;
const NODE_HEIGHT = 80;
const RANK_SEP = 100;
const NODE_WIDTH = 220;
const NODE_GAP = 30;
const LANE_ORDER: Record<FlowKind, number> = {
  ui: 0, api: 1, cron: 2, contract: 3, db: 4, redis: 5
};

/**
 * Cap each lane to the highest-degree N nodes and re-emit a horizontally compact
 * layout. dagre's TB layout balloons the x-spread to 17000+ px when one lane has
 * 56 entries; capping + manual lane positioning keeps the chart readable.
 */
function reflowGraph(graph: FlowGraph): FlowGraph & { laneOverflow: Record<FlowKind, number> } {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const byKind: Record<FlowKind, FlowNode[]> = { ui: [], api: [], cron: [], contract: [], db: [], redis: [] };
  for (const n of graph.nodes) byKind[n.data.kind].push(n);
  const laneOverflow: Record<FlowKind, number> = { ui: 0, api: 1, cron: 0, contract: 0, db: 0, redis: 0 };
  laneOverflow.api = 0;

  const kept: FlowNode[] = [];
  for (const kind of Object.keys(byKind) as FlowKind[]) {
    const all = byKind[kind].slice().sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const top = all.slice(0, PER_LANE_CAP);
    laneOverflow[kind] = Math.max(0, all.length - top.length);
    top.forEach((n, i) => {
      n.position = {
        x: i * (NODE_WIDTH + NODE_GAP) + NODE_WIDTH / 2,
        y: LANE_ORDER[kind] * (NODE_HEIGHT + RANK_SEP)
      };
      kept.push(n);
    });
  }
  const keptIds = new Set(kept.map(n => n.id));
  const edges = graph.edges.filter(e => keptIds.has(e.source) && keptIds.has(e.target));
  return { nodes: kept, edges, laneOverflow };
}

export function FlowChart({ domainId }: { domainId: number }) {
  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nodeTypes = useMemo(() => ({ panoramaNode: PanoramaNode }), []);

  useEffect(() => {
    fetch(`/api/domain/${domainId}/flow`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setGraph(j.data))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [domainId]);

  const reflowed = useMemo(() => (graph ? reflowGraph(graph) : null), [graph]);

  if (error) return <div className="text-type-contract p-4 text-sm">flow load failed: {error}</div>;
  if (!graph || !reflowed) return <div className="text-text-3 p-4 text-sm">Loading flow chart…</div>;
  if (reflowed.nodes.length === 0) {
    return <div className="text-text-3 p-4 text-sm">No relations to display for this domain yet.</div>;
  }

  const overflowSummary = (Object.entries(reflowed.laneOverflow) as [FlowKind, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}+${n}`)
    .join(' · ');

  return (
    <div className="bg-bg border border-bg-3 rounded relative">
      {overflowSummary && (
        <div className="absolute top-2 right-2 z-10 px-2 py-1 text-[10px] font-mono text-text-3 bg-bg-1/80 rounded backdrop-blur">
          每泳道最多 {PER_LANE_CAP} · 截断: {overflowSummary}
        </div>
      )}
      <div className="h-[640px]">
        <ReactFlow
          // Render directly from reflowed graph — no useNodesState race.
          // Trade-off: nodes aren't user-draggable, but this is a read-only viz.
          nodes={reflowed.nodes}
          edges={reflowed.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, minZoom: 0.3, maxZoom: 1.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#303248" gap={20} size={1} />
          <Controls className="!bg-bg-1 !border-bg-3 !text-text-2" />
          <MiniMap nodeColor={() => '#8378FF'} className="!bg-bg-1" />
        </ReactFlow>
      </div>
    </div>
  );
}
