import 'server-only';
import mysql, { type Pool } from 'mysql2/promise';

let pool: Pool | null = null;
export function getPool(): Pool {
  if (pool) return pool;
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'] as const;
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env ${k}`);
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST!,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_PASSWORD!,
    database: process.env.MYSQL_DATABASE!,
    connectionLimit: 8,
    timezone: 'Z'
  });
  return pool;
}
