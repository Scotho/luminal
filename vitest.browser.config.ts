import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/e2e/browser/**/*.test.ts'],
    exclude: [
      'src/e2e/browser/online-emulator/**',
      'src/e2e/browser/online-smoke/**',
      // Admin dashboard UI tests — require the Luminal admin running on :5175
      // and are tracked as a separate suite when the admin is up.
      'src/e2e/browser/admin/**',
      // Shop is disabled until the purchase flow is re-finalized.
      'src/e2e/browser/shop-purchase.test.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
