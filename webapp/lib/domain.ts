import 'server-only';
import type { RowDataPacket } from 'mysql2';
import { getPool } from './db';

export interface TreeRow {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: boolean;
  cronCount: number;
}

interface TreeQueryRow extends RowDataPacket {
  id: number;
  name: string;
  displayName: string;
  parentId: number | null;
  hasChildren: number; // 0 or 1
  cronCount: number;
}

export async function fetchTreeChildren(parentId: number | null): Promise<TreeRow[]> {
  const pool = getPool();
  const where = parentId === null ? 'd.parent_id IS NULL' : 'd.parent_id = ?';
  const params = parentId === null ? [] : [parentId];
  const [rows] = await pool.query<TreeQueryRow[]>(
    `SELECT
        d.id, d.name, d.display_name AS displayName, d.parent_id AS parentId,
        EXISTS(SELECT 1 FROM panorama_business_domain c WHERE c.parent_id = d.id) AS hasChildren,
        (SELECT COUNT(*) FROM panorama_cron_job cj WHERE cj.domain_id = d.id) AS cronCount
       FROM panorama_business_domain d
       WHERE ${where}
       ORDER BY d.sort_order, d.name`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    displayName: r.displayName,
    parentId: r.parentId === null ? null : Number(r.parentId),
    hasChildren: Boolean(r.hasChildren),
    cronCount: Number(r.cronCount)
  }));
}
