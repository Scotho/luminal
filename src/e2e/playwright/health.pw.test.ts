// Placeholder: ensures `npx playwright test` exits cleanly.
// All browser e2e tests run via vitest configs, not Playwright runner.
// Add Playwright-native tests here using @playwright/test imports.

import { test, expect } from '@playwright/test';

test('playwright runner health check', () => {
  expect(true).toBe(true);
});
