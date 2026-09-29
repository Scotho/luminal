import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/e2e/browser/online-smoke/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    retry: 1,
    globalSetup: ['./src/e2e/browser/online-smoke/smokeGlobalSetup.ts'],
  },
});
