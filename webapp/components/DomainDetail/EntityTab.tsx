import type { DomainEntity } from '@/lib/domain';
import Link from 'next/link';

export function EntityTab({ entities }: { entities: DomainEntity[] }) {
  if (entities.length === 0) return <p className="text-text-3">No entities linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">Table</th>
          <th className="text-left">Columns</th>
          <th className="text-left">File</th>
        </tr>
      </thead>
      <tbody>
        {entities.map((e) => {
          const cols = Array.isArray(e.columns) ? e.columns.length : 0;
          return (
            <tr key={e.id} className="border-t border-bg-3 hover:bg-bg-2">
              <td className="py-2 font-mono">
                <Link href={`/node/entity/${e.id}`} className="hover:underline">
                  {e.tableName}
                </Link>
              </td>
              <td className="text-text-2 text-xs">{cols} cols</td>
              <td className="text-text-3 font-mono text-xs">
                {e.repo}/{e.filePath}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
