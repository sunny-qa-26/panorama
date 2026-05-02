import type { DomainRoute } from '@/lib/domain';
import Link from 'next/link';

export function FrontendTab({ routes }: { routes: DomainRoute[] }) {
  if (routes.length === 0) return <p className="text-text-3">No frontend routes linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">App</th>
          <th className="text-left">Path</th>
          <th className="text-left">Component</th>
          <th>Lazy</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((r) => (
          <tr key={r.id} className="border-t border-bg-3 hover:bg-bg-2">
            <td className="py-2 font-mono text-xs">{r.appName}</td>
            <td className="font-mono">
              <Link href={`/node/route/${r.id}`} className="hover:underline">
                {r.path}
              </Link>
            </td>
            <td className="text-text-2">{r.component ?? '—'}</td>
            <td className="text-center">{r.isLazy ? '⏱' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
