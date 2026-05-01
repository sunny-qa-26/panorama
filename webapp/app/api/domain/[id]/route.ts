import { NextResponse } from 'next/server';
import { fetchDomainDetail } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const detail = await fetchDomainDetail(id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data: detail });
}
