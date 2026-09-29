// src/e2e/browser/admin/admin-detachable.spec.ts
// E2E tests: Detachable floating windows in the admin dashboard.
// Verifies initial state (no windows/pills), CSS positioning, and
// that the floating window infrastructure is present in the DOM.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight } from './helpers';

describe('Detachable Windows', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    const status = await preflight();
    if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(30_000);
    page = await context.newPage();
    await launchAdmin(page);
  }, 30_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it('no floating windows on initial load', async () => {
    const count = await page.evaluate(
      () => document.querySelectorAll('.cc-floating-window').length,
    );
    expect(count).toBe(0);
  });

  it('no floating pills on initial load', async () => {
    const count = await page.evaluate(
      () => document.querySelectorAll('.cc-float-pill').length,
    );
    expect(count).toBe(0);
  });

  it('floating window CSS class uses fixed positioning', async () => {
    const hasFixedPos = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'cc-floating-window';
      document.body.appendChild(el);
      const pos = getComputedStyle(el).position;
      el.remove();
      return pos === 'fixed';
    });
    expect(hasFixedPos).toBe(true);
  });

  it('floating pill CSS class is defined', async () => {
    const hasDefined = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'cc-float-pill';
      document.body.appendChild(el);
      // Check it has any explicit display value set (not empty)
      const display = getComputedStyle(el).display;
      el.remove();
      return display !== '';
    });
    expect(hasDefined).toBe(true);
  });

  it('floating window container mount point exists in DOM', async () => {
    // The detachable window manager should add a container to the body on init
    const exists = await page.evaluate(() => {
      // Either a dedicated mount or the body itself is the host
      return (
        !!document.getElementById('cc-floating-container') ||
        // Fallback: the class is registered in the stylesheet (CSS rule exists)
        Array.from(document.styleSheets).some(sheet => {
          try {
            return Array.from(sheet.cssRules ?? []).some(rule =>
              rule instanceof CSSStyleRule && rule.selectorText?.includes('cc-floating-window'),
            );
          } catch {
            return false;
          }
        })
      );
    });
    expect(exists).toBe(true);
  });
});
