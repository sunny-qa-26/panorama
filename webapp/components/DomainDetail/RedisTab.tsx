import type { DomainRedis } from '@/lib/domain';
import Link from 'next/link';

export function RedisTab({ redisKeys }: { redisKeys: DomainRedis[] }) {
  if (redisKeys.length === 0) return <p className="text-text-3">No Redis keys linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">Key Pattern</th>
          <th className="text-left">Type</th>
          <th className="text-left">Source</th>
        </tr>
      </thead>
      <tbody>
        {redisKeys.map((r) => (
          <tr key={r.id} className="border-t border-bg-3 hover:bg-bg-2">
            <td className="py-2 font-mono text-xs">
              <Link href={`/node/redis/${r.id}`} className="hover:underline">
                {r.keyPattern}
              </Link>
            </td>
            <td className="text-text-2 text-xs">{r.redisType}</td>
            <td className="text-text-3 font-mono text-xs">
              {r.sourceFile}
              {r.sourceLine ? `:${r.sourceLine}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
