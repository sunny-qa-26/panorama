'use client';

import { useEffect, useState } from 'react';

interface BuildMeta {
  buildId: string; status: string; startedAt: string; finishedAt: string | null;
  durationMs: number | null; triggerType: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SyncIndicator() {
  const [meta, setMeta] = useState<BuildMeta | null>(null);
  useEffect(() => {
    fetch('/api/build/latest', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setMeta(j.data));
  }, []);
  if (!meta) return <span className="text-text-3 text-xs">—</span>;
  const stamp = meta.finishedAt ?? meta.startedAt;
  return (
    <span className="text-xs text-text-2 font-mono">
      <span className="text-type-api">●</span> Synced {relativeTime(stamp)}
    </span>
  );
}
