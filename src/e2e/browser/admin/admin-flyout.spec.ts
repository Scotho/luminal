// src/e2e/browser/admin/admin-flyout.spec.ts
// E2E tests: Admin dashboard flyout panel — open/close, keyboard shortcuts,
// and structural elements (agent tabs, prompt editor, output area, search, CSS).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, SEL } from './helpers';

describe('Admin Flyout', () => {
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

  it('flyout starts collapsed', async () => {
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('flyout opens via status button click', async () => {
    await page.click(SEL.statusBtn);
    await page.waitForTimeout(300);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).not.toContain('collapsed');
  });

  it('flyout closes on Escape key', async () => {
    // Ensure flyout is open first
    const clsBefore = await page.locator(SEL.flyout).getAttribute('class');
    if (clsBefore?.includes('collapsed')) {
      await page.click(SEL.statusBtn);
      await page.waitForTimeout(300);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('Ctrl+\\ toggles flyout open', async () => {
    // Ensure closed first
    await page.evaluate(() => {
      document.getElementById('cc-flyout')?.classList.add('collapsed');
    });
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(300);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).not.toContain('collapsed');
  });

  it('Ctrl+\\ toggles flyout closed', async () => {
    // Ensure open first
    await page.evaluate(() => {
      document.getElementById('cc-flyout')?.classList.remove('collapsed');
    });
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(300);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('flyout has agent tabs area', async () => {
    // Open flyout
    await page.evaluate(() => {
      document.getElementById('cc-flyout')?.classList.remove('collapsed');
    });
    await page.waitForTimeout(300);

    const exists = await page.evaluate(() => !!document.getElementById('cc-agent-tabs'));
    expect(exists).toBe(true);
  });

  it('flyout has prompt editor mount', async () => {
    const exists = await page.evaluate(() => !!document.getElementById('cc-prompt-editor-mount'));
    expect(exists).toBe(true);
  });

  it('flyout output area exists', async () => {
    const exists = await page.evaluate(() => !!document.getElementById('cc-flyout-output'));
    expect(exists).toBe(true);
  });

  it('Ctrl+F opens search bar when flyout is open', async () => {
    // Ensure flyout is open
    await page.evaluate(() => {
      document.getElementById('cc-flyout')?.classList.remove('collapsed');
    });
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+f');
    await page.waitForTimeout(300);

    const searchVisible = await page.evaluate(() => {
      const el = document.querySelector('.cc-search-bar') as HTMLElement | null;
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    expect(searchVisible).toBe(true);

    // Escape should close search
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const searchHidden = await page.evaluate(() => {
      const el = document.querySelector('.cc-search-bar') as HTMLElement | null;
      if (!el) return true; // element removed = hidden
      const style = getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden';
    });
    expect(searchHidden).toBe(true);
  });

  it('markdown CSS class cc-code-block has a background color defined', async () => {
    const hasBg = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'cc-code-block';
      document.body.appendChild(el);
      const style = getComputedStyle(el);
      const bg = style.backgroundColor;
      el.remove();
      return bg !== '' && bg !== 'rgba(0, 0, 0, 0)';
    });
    expect(hasBg).toBe(true);
  });
});
