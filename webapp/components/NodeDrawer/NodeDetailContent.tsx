import type { NodeDetail } from '@/lib/node';
import { RelationsPanel } from './RelationsPanel';

const TYPE_BADGE: Record<string, string> = {
  cron: 'bg-type-cron/20 text-type-cron',
  api: 'bg-type-api/20 text-type-api',
  contract: 'bg-type-contract/20 text-type-contract',
  entity: 'bg-type-db/20 text-type-db',
  redis: 'bg-type-redis/20 text-type-redis',
  route: 'bg-type-ui/20 text-type-ui'
};

function ContractActions({ extra }: { extra: Record<string, unknown> }) {
  const address = extra.address as string;
  const chain = extra.chain as string;
  const abiPath = extra.abiPath as string | null;
  const isMainnet = chain.includes('mainnet');
  const explorerBase = chain.startsWith('bsc') ? 'https://bscscan.com' :
                       chain.startsWith('eth') ? (isMainnet ? 'https://etherscan.io' : 'https://sepolia.etherscan.io') :
                       null;
  return (
    <div className="flex gap-2 mt-3">
      {explorerBase && (
        <a href={`${explorerBase}/address/${address}`} target="_blank" rel="noreferrer"
           className="text-xs px-3 py-1 bg-bg-2 hover:bg-bg-3 rounded">
          🌐 {chain.includes('mainnet') ? 'Explorer' : 'Testnet Explorer'}
        </a>
      )}
      {abiPath && (
        <span className="text-xs px-3 py-1 bg-bg-2 rounded font-mono text-text-2">≡ {abiPath}</span>
      )}
    </div>
  );
}

export function NodeDetailContent({ detail }: { detail: NodeDetail }) {
  return (
    <article>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs uppercase font-mono px-2 py-0.5 rounded ${TYPE_BADGE[detail.type] ?? 'text-text-3'}`}>
          {detail.type}
        </span>
        {detail.domain && (
          <span className="text-xs text-text-3 font-mono">{detail.domain.displayName}</span>
        )}
      </div>
      <h2 className="text-lg font-semibold break-all">{detail.name}</h2>
      {detail.description && <p className="text-sm text-text-2 mt-2">{detail.description}</p>}
      {detail.filePath && (
        <p className="text-xs text-text-3 font-mono mt-2 break-all">
          {detail.filePath}{detail.lineNo ? `:${detail.lineNo}` : ''}
        </p>
      )}

      {detail.type === 'contract' && <ContractActions extra={detail.extra} />}

      <section className="mt-4 space-y-2">
        {Object.entries(detail.extra).map(([key, val]) => {
          if (val === null || val === undefined || val === '') return null;
          // Entity columns: render as a small list, not a JSON blob.
          if (key === 'columns' && Array.isArray(val)) {
            return <ColumnsList key={key} columns={val as ColumnSpec[]} />;
          }
          // Generic array of strings: render comma-separated badges.
          if (Array.isArray(val) && val.every((v) => typeof v === 'string')) {
            const arr = val as string[];
            if (arr.length === 0) return null;
            return (
              <div key={key} className="text-xs">
                <span className="text-text-3 uppercase mr-2">{key}</span>
                <span className="inline-flex flex-wrap gap-1">
                  {arr.map((v) => (
                    <span key={v} className="px-2 py-0.5 bg-bg-2 rounded font-mono">{v}</span>
                  ))}
                </span>
              </div>
            );
          }
          return (
            <div key={key} className="text-xs">
              <span className="text-text-3 uppercase mr-2">{key}</span>
              <span className="font-mono break-all">
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          );
        })}
      </section>

      <RelationsPanel usedBy={detail.usedBy} calls={detail.calls} />
    </article>
  );
}

interface ColumnSpec {
  name: string;
  type: string;
  nullable?: boolean;
  isPrimary?: boolean;
}

function ColumnsList({ columns }: { columns: ColumnSpec[] }) {
  if (columns.length === 0) return null;
  return (
    <div className="text-xs">
      <div className="text-text-3 uppercase mb-1">columns ({columns.length})</div>
      <table className="w-full font-mono text-xs">
        <tbody>
          {columns.map((c, i) => (
            <tr key={`${c.name}-${i}`} className="border-t border-bg-3">
              <td className="py-1 pr-2">
                {c.isPrimary && <span className="text-type-cron mr-1">★</span>}
                {c.name}
              </td>
              <td className="py-1 text-text-3">{c.type}</td>
              <td className="py-1 text-text-3 text-right">{c.nullable ? 'NULL' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
