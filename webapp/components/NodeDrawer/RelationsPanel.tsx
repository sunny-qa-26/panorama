import Link from 'next/link';
import type { RelationItem } from '@/lib/node';

export function RelationsPanel({ usedBy, calls }: { usedBy: RelationItem[]; calls: RelationItem[] }) {
  if (usedBy.length === 0 && calls.length === 0) return null;
  return (
    <section className="mt-6 space-y-4">
      {usedBy.length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-3 mb-2">Used by ({usedBy.length})</h3>
          <ul className="space-y-1">
            {usedBy.map(r => (
              <li key={`${r.type}:${r.id}`}>
                <Link href={r.href} className="block text-sm hover:bg-bg-2 px-2 py-1 rounded">
                  <span className="text-xs uppercase font-mono text-text-3 mr-2">{r.type}</span>
                  <span>{r.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {calls.length > 0 && (
        <div>
          <h3 className="text-xs uppercase text-text-3 mb-2">Calls ({calls.length})</h3>
          <ul className="space-y-1">
            {calls.map(r => (
              <li key={`${r.type}:${r.id}`}>
                <Link href={r.href} className="block text-sm hover:bg-bg-2 px-2 py-1 rounded">
                  <span className="text-xs uppercase font-mono text-text-3 mr-2">{r.type}</span>
                  <span>{r.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
