import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    root: resolve(__dirname),
    include: ['src/**/*.test.ts'],
  },
});
