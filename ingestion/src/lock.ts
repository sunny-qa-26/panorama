import type { Pool, RowDataPacket } from 'mysql2/promise';

const LOCK_NAME = 'panorama_rebuild';

interface LockRow extends RowDataPacket { got: number | null; }

/** Try to acquire MySQL advisory lock with 0s timeout. Returns true if acquired. */
export async function tryLock(pool: Pool): Promise<boolean> {
  const [rows] = await pool.query<LockRow[]>('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
  return rows[0]?.got === 1;
}

export async function releaseLock(pool: Pool): Promise<void> {
  await pool.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
}

export async function withLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const got = await tryLock(pool);
  if (!got) throw new Error('Another rebuild is in progress (advisory lock held)');
  try { return await fn(); }
  finally { await releaseLock(pool); }
}
