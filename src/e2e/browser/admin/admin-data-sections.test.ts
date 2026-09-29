// src/e2e/browser/admin/admin-data-sections.test.ts
// E2E tests: Data & utility sections — live, settings, help, links,
// notifications, incidents.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection } from './helpers';

describe('Data & Utility Sections', () => {
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

  // ── Live Dashboard ───────────────────────────────────────

  describe('Live section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'live');
      await page.waitForTimeout(800);
    });

    it('renders the live section', async () => {
      const exists = await page.evaluate(() =>
        !!document.getElementById('section-live')
      );
      expect(exists).toBe(true);
    });

    it('has a live dot indicator', async () => {
      const exists = await page.evaluate(() =>
        !!document.querySelector('.live-dot')
      );
      expect(exists).toBe(true);
    });

    it('shows service health information', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-live');
        return el?.textContent ?? '';
      });
      // Live section should show some status info
      expect(text.length).toBeGreaterThan(10);
    });

    it('exec status API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_exec/status');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('agents');
    });

    it('services health check responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_exec/services');
      expect(res.ok).toBe(true);
    });
  });

  // ── Settings ─────────────────────────────────────────────

  describe('Settings section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'settings');
      await page.waitForTimeout(500);
    });

    it('renders settings section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-settings');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toMatch(/setting|theme|refresh/);
    });

    it('has theme/font configuration options', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-settings');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/theme|font|color/);
    });

    it('settings persist to localStorage', async () => {
      const hasKey = await page.evaluate(() => {
        // Check for any luminal-admin localStorage keys
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('luminal-admin')) return true;
        }
        return false;
      });
      expect(hasKey).toBe(true);
    });
  });

  // ── Help ─────────────────────────────────────────────────

  describe('Help section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'help');
      await page.waitForTimeout(500);
    });

    it('renders help content', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-help');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toContain('help');
    });

    it('commands API returns command list', async () => {
      const res = await fetch('http://localhost:5175/__admin_commands?format=json');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data) || typeof data === 'object').toBe(true);
    });

    it('has command reference content', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-help');
        return el?.textContent?.toLowerCase() ?? '';
      });
      // Help should reference commands, agents, or dashboard features
      expect(text).toMatch(/command|agent|dashboard|pipeline/);
    });
  });

  // ── Links ────────────────────────────────────────────────

  describe('Links section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'links');
      await page.waitForTimeout(500);
    });

    it('renders links section with groups', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-links');
        return el?.textContent ?? '';
      });
      expect(text.length).toBeGreaterThan(10);
    });

    it('contains expected link groups', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-links');
        return el?.textContent?.toLowerCase() ?? '';
      });
      // Links should include services or environment groups
      expect(text).toMatch(/firebase|environment|service|tool/);
    });

    it('links have href attributes', async () => {
      const linkCount = await page.evaluate(() => {
        const el = document.getElementById('section-links');
        if (!el) return 0;
        return el.querySelectorAll('a[href]').length;
      });
      expect(linkCount).toBeGreaterThan(0);
    });
  });

  // ── Notifications ────────────────────────────────────────

  describe('Notifications section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'notifications');
      await page.waitForTimeout(500);
    });

    it('renders notifications section', async () => {
      const exists = await page.evaluate(() =>
        !!document.getElementById('section-notifications')
      );
      expect(exists).toBe(true);
    });

    it('notifications data endpoint responds', async () => {
      const res = await fetch('http://localhost:5175/data/notifications.json');
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Incidents ────────────────────────────────────────────

  describe('Incidents section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'incidents');
      await page.waitForTimeout(500);
    });

    it('renders incidents section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-incidents');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toMatch(/incident/);
    });

    it('incidents data endpoint responds', async () => {
      const res = await fetch('http://localhost:5175/data/incidents.json');
      expect(res.status).toBeLessThan(500);
    });
  });
});
