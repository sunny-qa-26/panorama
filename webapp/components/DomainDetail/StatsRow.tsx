interface Counts {
  cron: number;
  api: number;
  contract: number;
  db: number;
  redis: number;
  ui: number;
}

interface Stat {
  label: string;
  value: number;
  color: string;
}

export function StatsRow({ counts }: { counts: Counts }) {
  const cards: Stat[] = [
    { label: 'Cron Jobs', value: counts.cron, color: 'border-type-cron' },
    { label: 'API Endpoints', value: counts.api, color: 'border-type-api' },
    { label: 'Contracts', value: counts.contract, color: 'border-type-contract' },
    { label: 'Storage Keys', value: counts.db + counts.redis, color: 'border-type-db' }
  ];
  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className={`bg-bg-1 border-l-2 ${c.color} rounded px-4 py-3`}>
          <div className="text-text-3 text-xs uppercase tracking-wide">{c.label}</div>
          <div className="text-2xl font-mono mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
