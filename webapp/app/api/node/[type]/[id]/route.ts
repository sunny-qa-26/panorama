import { NextResponse } from 'next/server';
import { fetchNodeDetail, type NodeType } from '@/lib/node';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set<NodeType>(['cron','api','contract','entity','redis','route']);

export async function GET(_req: Request, { params }: { params: { type: string; id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!VALID_TYPES.has(params.type as NodeType)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const detail = await fetchNodeDetail(params.type as NodeType, id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data: detail });
}
