import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/e2e/**/*.test.ts'],
    exclude: ['src/e2e/browser/**', 'src/e2e/playwright/**'],
    testTimeout: 60_000,
    fileParallelism: false,
    globalSetup: ['./src/e2e/e2eGlobalSetup.ts'],
  },
});
