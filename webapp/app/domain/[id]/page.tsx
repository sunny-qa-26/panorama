import { notFound } from 'next/navigation';
import { fetchDomainDetail } from '@/lib/domain';
import { HeroBlock } from '@/components/DomainDetail/HeroBlock';
import { StatsRow } from '@/components/DomainDetail/StatsRow';
import { ImplementationTabs } from '@/components/DomainDetail/ImplementationTabs';

export const dynamic = 'force-dynamic';

export default async function DomainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const detail = await fetchDomainDetail(id);
  if (!detail) notFound();

  return (
    <article>
      <HeroBlock detail={detail} />
      <StatsRow stats={detail.stats} />
      <ImplementationTabs crons={detail.crons} />
    </article>
  );
}
