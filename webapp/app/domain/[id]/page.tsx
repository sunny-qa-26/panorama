import { notFound } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import { fetchDomainDetail, fetchDomainExtras } from '@/lib/domain';
import { loadMarkdown } from '@/lib/markdown';
import { HeroBlock } from '@/components/DomainDetail/HeroBlock';
import { StatsRow } from '@/components/DomainDetail/StatsRow';
import { ImplementationTabs } from '@/components/DomainDetail/ImplementationTabs';
import { KnowledgeMermaid } from '@/components/DomainDetail/KnowledgeMermaid';

const FlowChart = nextDynamic(
  () => import('@/components/DomainDetail/FlowChart').then((m) => m.FlowChart),
  { ssr: false }
);

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const detail = await fetchDomainDetail(id);
  if (!detail) notFound();
  const extras = await fetchDomainExtras(id);

  let body: { html: string; mermaidBlocks: string[] } | null = null;
  const firstDoc = detail.docs[0];
  if (firstDoc?.bodyMdPath) {
    body = await loadMarkdown(firstDoc.bodyMdPath).catch(() => null);
  }

  const counts = {
    cron: detail.crons.length,
    api: extras.apis.length,
    contract: extras.contracts.length,
    db: extras.entities.length,
    redis: extras.redisKeys.length,
    ui: extras.routes.length
  };

  return (
    <article>
      <HeroBlock detail={detail} />
      <StatsRow counts={counts} />

      {/* Business flow chart (PRD §6.2 — primary visual; precedes the tabular lists) */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">业务流程图</h2>
          <span className="text-xs text-text-3 font-mono">
            {counts.ui + counts.api + counts.cron + counts.contract + counts.db + counts.redis} nodes ·
            6 lanes
          </span>
        </div>
        <FlowChart domainId={id} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2 mb-2">实现清单</h2>
        <ImplementationTabs
          crons={detail.crons}
          apis={extras.apis}
          contracts={extras.contracts}
          entities={extras.entities}
          redisKeys={extras.redisKeys}
          routes={extras.routes}
        />
      </section>

      {body && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2 mb-2">业务文档</h2>
          <KnowledgeMermaid html={body.html} mermaidBlocks={body.mermaidBlocks} />
        </section>
      )}
    </article>
  );
}
