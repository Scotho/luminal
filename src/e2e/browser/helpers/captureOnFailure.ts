// src/e2e/browser/helpers/captureOnFailure.ts
// Shared helper: start Playwright tracing in beforeEach and capture screenshot + trace on failure.
//
// Usage (single-page tests):
//   import { setupFailureCapture } from './helpers/captureOnFailure.js';
//   ...
//   const capture = setupFailureCapture(() => session.page, () => session.context);
//   // Then call capture.beforeEach() / capture.afterEach() inside the appropriate hooks.
//
// Usage (multi-page / MatchFlow tests):
//   Call capturePages(pages, testName) directly in the catch block.

import fs from 'fs';
import path from 'path';
import type { Page, BrowserContext } from 'playwright';

const ARTIFACTS_DIR = 'test-results';

/** Sanitise a test name so it can be used as a file name. */
function sanitiseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100);
}

/** Ensure the artifacts directory exists. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Save a screenshot for one page.
 * @param page     - Playwright Page
 * @param label    - e.g. 'host', 'guest', or empty string for single-page tests
 * @param testName - Human-readable test name (will be sanitised)
 */
export async function captureScreenshot(page: Page, label: string, testName: string): Promise<void> {
  const dir = path.join(ARTIFACTS_DIR, 'screenshots');
  ensureDir(dir);
  const suffix = label ? `_${label}` : '';
  const file = path.join(dir, `${sanitiseName(testName)}${suffix}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    console.log(`[capture] screenshot → ${file}`);
  } catch (err) {
    console.warn(`[capture] screenshot failed for ${label || 'page'}: ${(err as Error).message}`);
  }
}

/**
 * Stop tracing for a context and save the trace zip.
 * Safe to call even if tracing was never started (catches all errors).
 */
export async function saveTrace(context: BrowserContext, label: string, testName: string): Promise<void> {
  const dir = path.join(ARTIFACTS_DIR, 'traces');
  ensureDir(dir);
  const suffix = label ? `_${label}` : '';
  const file = path.join(dir, `${sanitiseName(testName)}${suffix}.zip`);
  try {
    await context.tracing.stop({ path: file });
    console.log(`[capture] trace      → ${file}`);
  } catch (err) {
    // Tracing may not have been started — ignore silently
    const msg = (err as Error).message;
    if (!msg.includes('not started') && !msg.includes('already stopped')) {
      console.warn(`[capture] trace stop failed for ${label || 'context'}: ${msg}`);
    }
  }
}

/**
 * Capture screenshots for multiple named pages on failure.
 * Call this from inside a catch block before re-throwing.
 *
 * @param pages    - Array of { page, label } pairs
 * @param testName - Human-readable test name
 */
export async function capturePages(
  pages: Array<{ page: Page; label: string }>,
  testName: string,
): Promise<void> {
  await Promise.allSettled(pages.map(({ page, label }) => captureScreenshot(page, label, testName)));
}

/**
 * Factory that wires beforeEach/afterEach hooks for a single-page test suite.
 * Returns { beforeEach, afterEach } — call them from within your vitest hooks.
 *
 * The context getter is optional; if provided, tracing is started before each
 * test and saved on failure.
 *
 * @example
 *   const capture = setupFailureCapture(
 *     () => session.page,
 *     () => session.context,   // optional
 *   );
 *   beforeEach(capture.before);
 *   afterEach(capture.after);
 */
export function setupFailureCapture(
  getPage: () => Page | undefined,
  getContext?: () => BrowserContext | undefined,
): {
  before: (ctx: { task: { name: string } }) => Promise<void>;
  after: (ctx: { task: { name: string; result?: { state: string } } }) => Promise<void>;
} {
  return {
    async before({ task }) {
      const context = getContext?.();
      if (context) {
        try {
          await context.tracing.start({ screenshots: true, snapshots: true });
        } catch {
          // Tracing may already be running or unsupported — ignore
        }
      }
      void task; // suppress unused-variable lint
    },

    async after({ task }) {
      const failed = task.result?.state === 'fail';
      if (!failed) {
        // Stop and discard trace without saving
        const context = getContext?.();
        if (context) {
          try { await context.tracing.stop(); } catch { /* ignore */ }
        }
        return;
      }

      const page = getPage();
      if (page) {
        await captureScreenshot(page, '', task.name);
      }
      const context = getContext?.();
      if (context) {
        await saveTrace(context, '', task.name);
      }
    },
  };
}
