import { notFound } from 'next/navigation';
import { fetchNodeDetail, type NodeType } from '@/lib/node';
import { DrawerContainer } from '@/components/NodeDrawer/DrawerContainer';
import { NodeDetailContent } from '@/components/NodeDrawer/NodeDetailContent';

const VALID_TYPES = new Set<NodeType>(['cron','api','contract','entity','redis','route']);

export const dynamic = 'force-dynamic';

export default async function NodePage({ params }: { params: { type: string; id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id) || !VALID_TYPES.has(params.type as NodeType)) notFound();
  const detail = await fetchNodeDetail(params.type as NodeType, id);
  if (!detail) notFound();
  return (
    <DrawerContainer title={detail.name}>
      <NodeDetailContent detail={detail} />
    </DrawerContainer>
  );
}
