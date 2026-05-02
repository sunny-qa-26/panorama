import { NextResponse } from 'next/server';
import { search, type SearchType } from '@/lib/search';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set<SearchType>(['domain','doc','cron','api','contract','entity','redis','route']);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const typesParam = url.searchParams.get('types');
  let types: SearchType[] | undefined;
  if (typesParam) {
    types = typesParam.split(',')
      .map(s => s.trim() as SearchType)
      .filter(t => VALID_TYPES.has(t));
    if (types.length === 0) types = undefined;
  }
  const results = await search(q, types);
  return NextResponse.json({ data: results });
}
