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
      <ImplementationTabs
        crons={detail.crons}
        apis={extras.apis}
        contracts={extras.contracts}
        entities={extras.entities}
        redisKeys={extras.redisKeys}
        routes={extras.routes}
      />
      {/* Business flow chart */}
      <FlowChart domainId={id} />
      {body && <KnowledgeMermaid html={body.html} mermaidBlocks={body.mermaidBlocks} />}
    </article>
  );
}
