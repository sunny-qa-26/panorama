import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    setupFiles: ['__tests__/setup.ts']
  },
  resolve: {
    alias: {
      '@': here,
      // server-only throws when imported from client/test contexts. In tests we
      // exercise these modules directly, so stub the marker out.
      'server-only': path.resolve(here, '__tests__/stubs/server-only.ts')
    }
  }
});
