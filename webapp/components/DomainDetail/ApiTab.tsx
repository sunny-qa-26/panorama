import type { DomainApi } from '@/lib/domain';
import Link from 'next/link';

export function ApiTab({ apis }: { apis: DomainApi[] }) {
  if (apis.length === 0) return <p className="text-text-3">No API endpoints linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">Method</th>
          <th className="text-left">Path</th>
          <th className="text-left">Controller</th>
          <th className="text-left">File</th>
          <th>Auth</th>
        </tr>
      </thead>
      <tbody>
        {apis.map((a) => (
          <tr key={a.id} className="border-t border-bg-3 hover:bg-bg-2">
            <td className="py-2 font-mono text-xs">{a.httpMethod}</td>
            <td className="font-mono">
              <Link href={`/node/api/${a.id}`} className="hover:underline">
                {a.path}
              </Link>
            </td>
            <td className="text-text-2">{a.controller ?? '—'}</td>
            <td className="text-text-3 font-mono text-xs">
              {a.repo}/{a.filePath}
              {a.lineNo ? `:${a.lineNo}` : ''}
            </td>
            <td className="text-center">{a.authRequired ? '🔒' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
