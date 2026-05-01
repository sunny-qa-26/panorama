import { createConnection } from './connection.js';
import { applyMigrations, listApplied, listPending } from './runner.js';

function usage(): never {
  console.error('Usage: tsx src/cli.ts <apply|status>');
  process.exit(1);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== 'apply' && cmd !== 'status') usage();

  const conn = await createConnection();
  try {
    if (cmd === 'apply') {
      const out = await applyMigrations({ conn, sqlDir: 'sql' });
      console.log('Applied:', out.applied.length ? out.applied.join(', ') : '(none — already up to date)');
    } else {
      const applied = await listApplied(conn);
      const pending = await listPending({ conn, sqlDir: 'sql' });
      console.log(`Applied (${applied.length}):`, applied);
      console.log(`Pending (${pending.length}):`, pending);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
