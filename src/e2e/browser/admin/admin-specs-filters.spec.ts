// src/e2e/browser/admin/admin-specs-filters.spec.ts
// E2E tests: Specs page — filter by status, search, count display.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight } from './helpers';

describe('Specs Page Filters', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    const status = await preflight();
    if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(15_000);
    page = await context.newPage();
    await launchAdmin(page);

    // Navigate to the specs section
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>('.nav-item[data-section="specs"]');
      btn?.click();
    });
    // Wait for the spec list to populate
    await page.waitForSelector('#spec-status-filter', { timeout: 10_000 });
  }, 30_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  // ── Section loads ────────────────────────────────────────

  it('specs section container exists', async () => {
    const exists = await page.evaluate(() =>
      !!document.getElementById('section-specs')
    );
    expect(exists).toBe(true);
  });

  it('spec list has items', async () => {
    const count = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );
    expect(count).toBeGreaterThan(0);
  });

  // ── Filter bar elements ──────────────────────────────────

  it('status filter dropdown is present', async () => {
    const exists = await page.evaluate(() =>
      !!document.getElementById('spec-status-filter')
    );
    expect(exists).toBe(true);
  });

  it('search input is present', async () => {
    const exists = await page.evaluate(() =>
      !!document.getElementById('spec-search')
    );
    expect(exists).toBe(true);
  });

  it('count display shows total', async () => {
    const text = await page.evaluate(() =>
      document.getElementById('spec-count')?.textContent ?? ''
    );
    // Should match pattern "N / N" where both numbers are equal when no filter
    expect(text).toMatch(/\d+ \/ \d+/);
    const [shown, total] = text.split('/').map(s => parseInt(s.trim()));
    expect(shown).toBe(total);
  });

  it('status dropdown has "All" as first option', async () => {
    const firstOption = await page.evaluate(() => {
      const select = document.getElementById('spec-status-filter') as HTMLSelectElement;
      return select?.options[0]?.textContent ?? '';
    });
    expect(firstOption).toBe('All');
  });

  it('status dropdown contains expected status values', async () => {
    const options = await page.evaluate(() => {
      const select = document.getElementById('spec-status-filter') as HTMLSelectElement;
      return Array.from(select?.options ?? []).map(o => o.textContent);
    });
    expect(options).toContain('Completed');
    expect(options).toContain('Approved');
  });

  // ── Status filtering ─────────────────────────────────────

  it('filtering by Completed reduces the list', async () => {
    const totalBefore = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );

    // Select "Completed"
    await page.selectOption('#spec-status-filter', 'Completed');
    await page.waitForTimeout(200);

    const countAfter = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );
    expect(countAfter).toBeLessThan(totalBefore);
    expect(countAfter).toBeGreaterThan(0);

    // Count display should reflect filtered count
    const countText = await page.evaluate(() =>
      document.getElementById('spec-count')?.textContent ?? ''
    );
    const [shown] = countText.split('/').map(s => parseInt(s.trim()));
    expect(shown).toBe(countAfter);
  });

  it('filtering by Draft shows only draft specs', async () => {
    await page.selectOption('#spec-status-filter', 'Draft');
    await page.waitForTimeout(200);

    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.spec-item');
      return Array.from(nodes).map(el => el.textContent ?? '');
    });
    expect(items.length).toBeGreaterThan(0);
    // Every visible item should display "Draft" in its subtitle
    for (const text of items) {
      expect(text.toLowerCase()).toContain('draft');
    }
  });

  it('resetting filter to All restores full list', async () => {
    // Get total from count display
    const totalText = await page.evaluate(() =>
      document.getElementById('spec-count')?.textContent ?? ''
    );
    const total = parseInt(totalText.split('/')[1]?.trim() ?? '0');

    await page.selectOption('#spec-status-filter', 'All');
    await page.waitForTimeout(200);

    const countAfter = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );
    expect(countAfter).toBe(total);
  });

  // ── Text search ──────────────────────────────────────────

  it('searching narrows the list', async () => {
    const totalBefore = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );

    await page.fill('#spec-search', 'admin');
    await page.waitForTimeout(300);

    const countAfter = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );
    expect(countAfter).toBeLessThan(totalBefore);
    expect(countAfter).toBeGreaterThan(0);
  });

  it('search matches are visible in the list', async () => {
    // Search should still be "admin" from prior test
    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.spec-item');
      return Array.from(nodes).map(el => {
        const label = el.querySelector('div')?.textContent ?? '';
        return label.toLowerCase();
      });
    });
    for (const label of items) {
      expect(label).toContain('admin');
    }
  });

  it('clearing search restores full list', async () => {
    await page.fill('#spec-search', '');
    await page.waitForTimeout(200);

    const countText = await page.evaluate(() =>
      document.getElementById('spec-count')?.textContent ?? ''
    );
    const [shown, total] = countText.split('/').map(s => parseInt(s.trim()));
    expect(shown).toBe(total);
  });

  // ── Combined filters ─────────────────────────────────────

  it('status + search combine correctly', async () => {
    await page.selectOption('#spec-status-filter', 'Completed');
    await page.fill('#spec-search', 'audio');
    await page.waitForTimeout(300);

    const items = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.spec-item');
      return Array.from(nodes).map(el => el.textContent?.toLowerCase() ?? '');
    });

    expect(items.length).toBeGreaterThan(0);
    for (const text of items) {
      expect(text).toContain('audio');
      expect(text).toContain('completed');
    }

    // Reset
    await page.selectOption('#spec-status-filter', 'All');
    await page.fill('#spec-search', '');
    await page.waitForTimeout(200);
  });

  // ── No results ───────────────────────────────────────────

  it('nonsense search shows zero items', async () => {
    await page.fill('#spec-search', 'zzzznonexistent99999');
    await page.waitForTimeout(200);

    const count = await page.evaluate(() =>
      document.querySelectorAll('.spec-item').length
    );
    expect(count).toBe(0);

    const countText = await page.evaluate(() =>
      document.getElementById('spec-count')?.textContent ?? ''
    );
    expect(countText).toMatch(/^0 \//);

    // Reset
    await page.fill('#spec-search', '');
    await page.waitForTimeout(200);
  });
});
