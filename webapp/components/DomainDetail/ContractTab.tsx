import type { DomainContract } from '@/lib/domain';
import Link from 'next/link';

export function ContractTab({ contracts }: { contracts: DomainContract[] }) {
  if (contracts.length === 0)
    return (
      <p className="text-text-3">
        No contracts linked to this domain (callers not yet wired in Phase 2).
      </p>
    );
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">Name</th>
          <th className="text-left">Chain</th>
          <th className="text-left">Address</th>
          <th>ABI</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c) => (
          <tr key={c.id} className="border-t border-bg-3 hover:bg-bg-2">
            <td className="py-2 font-mono">
              <Link href={`/node/contract/${c.id}`} className="hover:underline">
                {c.name}
              </Link>
            </td>
            <td className="text-text-2 text-xs">{c.chain}</td>
            <td className="font-mono text-xs break-all">{c.address}</td>
            <td className="text-center">{c.abiPath ? '✓' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
