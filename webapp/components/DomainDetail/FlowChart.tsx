'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import { PanoramaNode } from './PanoramaNode';
import type { FlowGraph } from '@/lib/flow';

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

  // Always-call hooks to satisfy React's rules-of-hooks; pass [] when graph is null.
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!graph) return;
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  if (error) return <div className="text-type-contract p-4 text-sm">flow load failed: {error}</div>;
  if (!graph) return <div className="text-text-3 p-4 text-sm">Loading flow chart…</div>;
  if (graph.nodes.length === 0) {
    return <div className="text-text-3 p-4 text-sm">No relations to display for this domain yet.</div>;
  }

  return (
    <div className="h-[600px] bg-bg border border-bg-3 rounded mt-6">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#303248" gap={20} size={1} />
        <Controls className="!bg-bg-1 !border-bg-3 !text-text-2" />
        <MiniMap nodeColor={() => '#8378FF'} className="!bg-bg-1" />
      </ReactFlow>
    </div>
  );
}
