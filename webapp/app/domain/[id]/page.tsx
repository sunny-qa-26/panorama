import { notFound } from 'next/navigation';
import { fetchDomainDetail } from '@/lib/domain';
import { loadMarkdown } from '@/lib/markdown';
import { HeroBlock } from '@/components/DomainDetail/HeroBlock';
import { StatsRow } from '@/components/DomainDetail/StatsRow';
import { ImplementationTabs } from '@/components/DomainDetail/ImplementationTabs';
import { KnowledgeMermaid } from '@/components/DomainDetail/KnowledgeMermaid';

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const detail = await fetchDomainDetail(id);
  if (!detail) notFound();

  let body: { html: string; mermaidBlocks: string[] } | null = null;
  const firstDoc = detail.docs[0];
  if (firstDoc?.bodyMdPath) {
    body = await loadMarkdown(firstDoc.bodyMdPath).catch(() => null);
  }

  return (
    <article>
      <HeroBlock detail={detail} />
      <StatsRow stats={detail.stats} />
      <ImplementationTabs crons={detail.crons} />
      {body && <KnowledgeMermaid html={body.html} mermaidBlocks={body.mermaidBlocks} />}
    </article>
  );
}
