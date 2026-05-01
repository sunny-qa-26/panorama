import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

interface BuildRow extends RowDataPacket {
  buildId: string;
  status: string;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  durationMs: number | null;
  triggerType: string;
  statsJson: string | Record<string, unknown> | null;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const [rows] = await getPool().query<BuildRow[]>(
    `SELECT build_id AS buildId, status, started_at AS startedAt, finished_at AS finishedAt,
            duration_ms AS durationMs, trigger_type AS triggerType, stats_json AS statsJson
       FROM panorama_build_meta WHERE status = 'success' ORDER BY started_at DESC LIMIT 1`
  );
  const row = rows[0] ?? null;
  if (!row) return NextResponse.json({ data: null });
  const toIso = (v: Date | string | null) => v === null ? null : (v instanceof Date ? v.toISOString() : v);
  return NextResponse.json({
    data: {
      buildId: row.buildId,
      status: row.status,
      startedAt: toIso(row.startedAt),
      finishedAt: toIso(row.finishedAt),
      durationMs: row.durationMs,
      triggerType: row.triggerType,
      statsJson: row.statsJson
    }
  });
}
