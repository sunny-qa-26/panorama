'use client';

import { useState } from 'react';
import { CronTab } from './CronTab';
import type { DomainCron } from '@/lib/domain';

const TABS = [
  { id: 'ui', label: 'UI', enabled: false },
  { id: 'api', label: 'API', enabled: false },
  { id: 'cron', label: 'Cron', enabled: true },
  { id: 'contract', label: 'Contract', enabled: false },
  { id: 'db', label: 'DB', enabled: false },
  { id: 'redis', label: 'Redis', enabled: false }
] as const;

type TabId = typeof TABS[number]['id'];

export function ImplementationTabs({ crons }: { crons: DomainCron[] }) {
  const [active, setActive] = useState<TabId>('cron');
  return (
    <section>
      <div className="flex border-b border-bg-3 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            disabled={!t.enabled}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              active === t.id
                ? 'border-primary text-text'
                : 'border-transparent text-text-3 hover:text-text-2'
            } ${!t.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {t.label}
            {!t.enabled && ' (Phase 2)'}
          </button>
        ))}
      </div>
      {active === 'cron' && <CronTab crons={crons} />}
    </section>
  );
}
