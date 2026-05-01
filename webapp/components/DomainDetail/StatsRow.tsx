import type { DomainStats } from '@/lib/domain';

interface Stat {
  label: string;
  value: number;
  color: string;
}

export function StatsRow({ stats }: { stats: DomainStats }) {
  const cards: Stat[] = [
    { label: 'Cron Jobs', value: stats.cronCount, color: 'border-type-cron' },
    { label: 'API Endpoints', value: stats.apiCount, color: 'border-type-api' },
    { label: 'Contracts', value: stats.contractCount, color: 'border-type-contract' },
    { label: 'Storage Keys', value: stats.storageCount, color: 'border-type-db' }
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
