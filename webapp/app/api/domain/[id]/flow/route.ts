import { NextResponse } from 'next/server';
import { buildFlow } from '@/lib/flow';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (Number.isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const graph = await buildFlow(id);
  return NextResponse.json({ data: graph });
}
