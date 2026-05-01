import 'dotenv/config';
import mysql from 'mysql2/promise';

export async function createConnection() {
  const required = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'] as const;
  for (const k of required) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
    timezone: 'Z'
  });
}
