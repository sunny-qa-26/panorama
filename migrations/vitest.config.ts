import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
