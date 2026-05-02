'use client';

import { useState } from 'react';
import { CronTab } from './CronTab';
import { ApiTab } from './ApiTab';
import { ContractTab } from './ContractTab';
import { EntityTab } from './EntityTab';
import { RedisTab } from './RedisTab';
import { FrontendTab } from './FrontendTab';
import type {
  DomainCron,
  DomainApi,
  DomainContract,
  DomainEntity,
  DomainRedis,
  DomainRoute
} from '@/lib/domain';

interface Props {
  crons: DomainCron[];
  apis: DomainApi[];
  contracts: DomainContract[];
  entities: DomainEntity[];
  redisKeys: DomainRedis[];
  routes: DomainRoute[];
}

const TABS = [
  { id: 'ui', label: 'UI' },
  { id: 'api', label: 'API' },
  { id: 'cron', label: 'Cron' },
  { id: 'contract', label: 'Contract' },
  { id: 'db', label: 'DB' },
  { id: 'redis', label: 'Redis' }
] as const;

type TabId = typeof TABS[number]['id'];

export function ImplementationTabs(props: Props) {
  const counts: Record<TabId, number> = {
    ui: props.routes.length,
    api: props.apis.length,
    cron: props.crons.length,
    contract: props.contracts.length,
    db: props.entities.length,
    redis: props.redisKeys.length
  };
  // Pick first tab with content as default; fall back to cron
  const initialTab: TabId = (Object.keys(counts) as TabId[]).find((k) => counts[k] > 0) ?? 'cron';
  const [active, setActive] = useState<TabId>(initialTab);

  return (
    <section>
      <div className="flex border-b border-bg-3 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              active === t.id
                ? 'border-primary text-text'
                : 'border-transparent text-text-3 hover:text-text-2'
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="ml-1 text-xs text-text-3">({counts[t.id]})</span>}
          </button>
        ))}
      </div>
      {active === 'ui' && <FrontendTab routes={props.routes} />}
      {active === 'api' && <ApiTab apis={props.apis} />}
      {active === 'cron' && <CronTab crons={props.crons} />}
      {active === 'contract' && <ContractTab contracts={props.contracts} />}
      {active === 'db' && <EntityTab entities={props.entities} />}
      {active === 'redis' && <RedisTab redisKeys={props.redisKeys} />}
    </section>
  );
}
