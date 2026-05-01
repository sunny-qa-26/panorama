'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Node {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: boolean;
  cronCount: number;
  children?: Node[];
  loading?: boolean;
  expanded?: boolean;
}

async function fetchChildren(parentId: number | null): Promise<Node[]> {
  const url = parentId === null ? '/api/tree' : `/api/tree?parent_id=${parentId}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = (await res.json()) as { data: Node[] };
  return json.data;
}

export default function BusinessTree() {
  const router = useRouter();
  const [roots, setRoots] = useState<Node[]>([]);

  useEffect(() => {
    void fetchChildren(null).then(setRoots);
  }, []);

  const toggle = async (node: Node) => {
    if (node.expanded) {
      node.expanded = false;
      setRoots([...roots]);
      return;
    }
    if (!node.children) {
      node.loading = true;
      setRoots([...roots]);
      node.children = await fetchChildren(node.id);
      node.loading = false;
    }
    node.expanded = true;
    setRoots([...roots]);
  };

  const renderNode = (node: Node, depth: number): React.ReactNode => (
    <li key={node.id}>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-2 cursor-pointer text-sm"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {node.hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void toggle(node);
            }}
            className="text-text-3 w-4"
            aria-label={node.expanded ? 'collapse' : 'expand'}
          >
            {node.expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="flex-1 truncate" onClick={() => router.push(`/domain/${node.id}`)}>
          {node.displayName}
        </span>
        {node.cronCount > 0 && (
          <span className="text-xs text-text-3 font-mono">{node.cronCount}</span>
        )}
      </div>
      {node.expanded && node.children && (
        <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>
      )}
    </li>
  );

  return <ul className="py-2">{roots.map((n) => renderNode(n, 0))}</ul>;
}
