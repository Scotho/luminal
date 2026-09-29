// src/e2e/browser/admin/admin-operations.test.ts
// E2E tests: Operations sections — ollama, feature flags, overseer,
// scheduler, bugs, database, function logs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection } from './helpers';

describe('Operations Sections', () => {
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
  }, 30_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  // ── Ollama ───────────────────────────────────────────────

  describe('Ollama section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'ollama');
      await page.waitForTimeout(800);
    });

    it('renders ollama section', async () => {
      await page.waitForFunction(() => {
        const el = document.getElementById('section-ollama');
        return (el?.textContent?.length ?? 0) > 5;
      }, { timeout: 5000 });
      const exists = await page.evaluate(() =>
        !!document.getElementById('section-ollama')
      );
      expect(exists).toBe(true);
    });

    it('ollama status API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_ollama/status');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('running');
    });

    it('ollama config API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_ollama/config');
      expect(res.ok).toBe(true);
    });

    it('ollama section is in the DOM', async () => {
      const exists = await page.evaluate(() =>
        !!document.getElementById('section-ollama')
      );
      expect(exists).toBe(true);
    });
  });

  // ── Feature Flags ────────────────────────────────────────

  describe('Feature Flags section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'feature-flags');
      await page.waitForTimeout(800);
    });

    it('renders feature flags section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-feature-flags');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/feature|flag/);
    });

    it('has a flag list container', async () => {
      const hasFlagContent = await page.evaluate(() => {
        const el = document.getElementById('section-feature-flags');
        if (!el) return false;
        const text = el.textContent?.toLowerCase() ?? '';
        return text.includes('flag') || text.includes('toggle') || text.includes('enabled') || text.includes('disabled');
      });
      expect(hasFlagContent).toBe(true);
    });
  });

  // ── Overseer ─────────────────────────────────────────────

  describe('Overseer section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'overseer');
      await page.waitForTimeout(600);
    });

    it('renders overseer section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-overseer');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/overseer|monitor|domain/);
    });

    it('overseer config API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_overseer/config');
      expect(res.ok).toBe(true);
    });

    it('overseer state API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_overseer/state');
      expect(res.ok).toBe(true);
    });

    it('overseer orders API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_overseer/orders');
      expect(res.ok).toBe(true);
    });
  });

  // ── Scheduler ────────────────────────────────────────────

  describe('Scheduler section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'scheduler');
      await page.waitForTimeout(500);
    });

    it('renders scheduler section', async () => {
      // Wait for lazy-loaded content
      await page.waitForFunction(() => {
        const el = document.getElementById('section-scheduler');
        return (el?.textContent?.length ?? 0) > 5;
      }, { timeout: 5000 });
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-scheduler');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/schedul|task|trigger|cron/);
    });

    it('scheduler data is accessible', async () => {
      const res = await fetch('http://localhost:5175/data/scheduled-tasks.json');
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Bugs ─────────────────────────────────────────────────

  describe('Bugs section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'bugs');
      await page.waitForTimeout(600);
    });

    it('renders bugs section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-bugs');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/bug|error|report/);
    });
  });

  // ── Database ─────────────────────────────────────────────

  describe('Database section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'database');
      await page.waitForTimeout(600);
    });

    it('renders database section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-database');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/database|rtdb|firestore/);
    });

    it('has tab interface (RTDB/Firestore)', async () => {
      const hasTabs = await page.evaluate(() => {
        const el = document.getElementById('section-database');
        if (!el) return false;
        const text = el.textContent?.toLowerCase() ?? '';
        return text.includes('rtdb') || text.includes('realtime') || text.includes('firestore');
      });
      expect(hasTabs).toBe(true);
    });
  });

  // ── Function Logs ────────────────────────────────────────

  describe('Function Logs section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'function-logs');
      await page.waitForTimeout(500);
    });

    it('renders function logs section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-function-logs');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/log|function/);
    });
  });
});
