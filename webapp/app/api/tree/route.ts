import { NextResponse } from 'next/server';
import { fetchTreeChildren } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('parent_id');
  const parentId = raw === null || raw === '' ? null : Number(raw);
  if (parentId !== null && Number.isNaN(parentId)) {
    return NextResponse.json({ error: 'parent_id must be numeric' }, { status: 400 });
  }
  const rows = await fetchTreeChildren(parentId);
  return NextResponse.json({ data: rows });
}
