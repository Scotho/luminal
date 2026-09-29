import { defineConfig, devices } from '@playwright/test';

// All browser tests use vitest as runner (not @playwright/test fixtures).
// Vitest configs: vitest.browser.config.ts, vitest.online.config.ts, vitest.smoke.config.ts
// This Playwright config is retained for future tests using @playwright/test fixtures.
// Place Playwright-native tests in src/e2e/playwright/ with *.pw.test.ts naming.
export default defineConfig({
  testDir: 'src/e2e/playwright',
  timeout: 120_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright-results.json' }]],

  use: {
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'smoke',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.SMOKE_TARGET_URL ?? 'https://luminal-game.web.app',
      },
    },
    {
      name: 'emulator',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'layout',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5175',
      },
    },
  ],
});
