'use client';

import { Handle, Position } from 'reactflow';
import Link from 'next/link';
import type { FlowKind } from '@/lib/flow';

const KIND_COLOR: Record<FlowKind, string> = {
  ui: 'border-type-ui',
  api: 'border-type-api',
  cron: 'border-type-cron',
  contract: 'border-type-contract',
  db: 'border-type-db',
  redis: 'border-type-redis'
};

const KIND_LABEL: Record<FlowKind, string> = {
  ui: 'UI',
  api: 'API',
  cron: 'CRON',
  contract: 'SOL',
  db: 'DB',
  redis: 'RDS'
};

interface NodeData {
  kind: FlowKind;
  name: string;
  subtitle: string | null;
  confidence: number;
  href: string;
}

export function PanoramaNode({ data }: { data: NodeData }) {
  return (
    <div
      className={`bg-bg-2 border-t-2 ${KIND_COLOR[data.kind]} rounded shadow-md w-[200px] overflow-hidden`}
    >
      <Handle type="target" position={Position.Top} className="!bg-text-3" />
      <div className="px-2 py-1 text-[10px] uppercase font-mono text-text-3 border-b border-bg-3">
        {KIND_LABEL[data.kind]}
        {data.confidence < 1 && (
          <span className="ml-2 text-text-3">({data.confidence.toFixed(1)})</span>
        )}
      </div>
      <div className="px-2 py-2">
        <Link href={data.href} className="block text-xs font-mono truncate hover:underline">
          {data.name}
        </Link>
        {data.subtitle && (
          <div className="text-[10px] text-text-3 truncate font-mono mt-1">{data.subtitle}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-text-3" />
    </div>
  );
}
