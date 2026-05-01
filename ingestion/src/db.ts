import mysql, { type Pool } from 'mysql2/promise';
import { loadEnv } from './env.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const e = loadEnv();
  pool = mysql.createPool({
    host: e.mysqlHost,
    port: e.mysqlPort,
    user: e.mysqlUser,
    password: e.mysqlPassword,
    database: e.mysqlDatabase,
    connectionLimit: 4,
    multipleStatements: true,
    timezone: 'Z'
  });
  return pool;
}

export async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}
