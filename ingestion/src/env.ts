import 'dotenv/config';

const REQUIRED = [
  'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE', 'REPOS_PATH'
] as const;

export function loadEnv() {
  for (const k of REQUIRED) {
    if (!process.env[k]) throw new Error(`Missing env ${k}`);
  }
  return {
    mysqlHost: process.env.MYSQL_HOST!,
    mysqlPort: Number(process.env.MYSQL_PORT ?? 3306),
    mysqlUser: process.env.MYSQL_USER!,
    mysqlPassword: process.env.MYSQL_PASSWORD!,
    mysqlDatabase: process.env.MYSQL_DATABASE!,
    reposPath: process.env.REPOS_PATH!
  };
}
