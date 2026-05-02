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
          if (val === null || val === undefined) return null;
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
