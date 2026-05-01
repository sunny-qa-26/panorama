type Level = 'info' | 'warn' | 'error';
export function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level, msg, ...data };
  console.log(JSON.stringify(line));
}
