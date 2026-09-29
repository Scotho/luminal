import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    exclude: ['src/e2e/**', 'src/ui/__tests__/loadoutPreview.test.ts'],
    setupFiles: ['src/ui/__tests__/helpers/setupDom.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/types/**'],
    },
  },
});
