// src/e2e/browser/admin/admin-planning.test.ts
// E2E tests: Planning sections — tasks, sessions, notes, decisions.
// (Specs page has its own dedicated test file: admin-specs-filters.spec.ts)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection } from './helpers';

describe('Planning Sections', () => {
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

  // ── Tasks ────────────────────────────────────────────────

  describe('Tasks section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'tasks');
      await page.waitForTimeout(500);
    });

    it('renders the tasks section with content', async () => {
      // Wait for section to render content (lazy-loaded)
      await page.waitForFunction(() => {
        const el = document.getElementById('section-tasks');
        return (el?.textContent?.length ?? 0) > 10;
      }, { timeout: 5000 });
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-tasks');
        return el?.textContent ?? '';
      });
      expect(text.length).toBeGreaterThan(0);
    });

    it('fetches tasks data from /data/tasks.json', async () => {
      const res = await fetch('http://localhost:5175/data/tasks.json');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('tasks API endpoint responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_task/bulk?tag=all');
      // May 404 if no tasks with that tag, but shouldn't 500
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Sessions ─────────────────────────────────────────────

  describe('Sessions section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'sessions');
      await page.waitForTimeout(500);
    });

    it('sessions section exists and is navigable', async () => {
      // Retry on HMR context destruction
      let exists = false;
      for (let i = 0; i < 2; i++) {
        try {
          exists = await page.evaluate(() =>
            !!document.getElementById('section-sessions')
          );
          break;
        } catch {
          await page.waitForTimeout(1000);
        }
      }
      expect(exists).toBe(true);
    });

    it('sessions API returns data', async () => {
      const res = await fetch('http://localhost:5175/data/sessions.json');
      expect(res.ok).toBe(true);
      const data = await res.json();
      // sessions.json should be an array or object
      expect(data).toBeTruthy();
    });

    it('session status labels use expected colors', async () => {
      // Verify the status->color mapping CSS is loaded
      const colors = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          green: style.getPropertyValue('--green').trim(),
          yellow: style.getPropertyValue('--yellow').trim(),
          accent: style.getPropertyValue('--accent').trim(),
        };
      });
      expect(colors.green).toBeTruthy();
      expect(colors.accent).toBeTruthy();
    });
  });

  // ── Notes ────────────────────────────────────────────────

  describe('Notes section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'notes');
      await page.waitForTimeout(500);
    });

    it('renders the notes section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-notes');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toContain('note');
    });

    it('has interactive note elements', async () => {
      const hasInteractiveElements = await page.evaluate(() => {
        const section = document.getElementById('section-notes');
        if (!section) return false;
        // Check for any input, textarea, or button in the notes section
        return section.querySelectorAll('input, textarea, button, [contenteditable]').length > 0;
      });
      expect(hasInteractiveElements).toBe(true);
    });

    it('notes data endpoint responds', async () => {
      const res = await fetch('http://localhost:5175/data/notes.json');
      // May 404 if file doesn't exist yet, that's OK
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Decisions ────────────────────────────────────────────

  describe('Decisions section', () => {
    beforeAll(async () => {
      // Decisions may be rendered inside notes or have its own section
      await navigateToSection(page, 'notes');
      await page.waitForTimeout(500);
    });

    it('decisions data endpoint responds', async () => {
      const res = await fetch('http://localhost:5175/data/decisions.json');
      expect(res.status).toBeLessThan(500);
    });

    it('decisions save endpoint accepts POST', async () => {
      const readRes = await fetch('http://localhost:5175/data/decisions.json');
      // The endpoint should respond without server error regardless of whether data exists
      expect(readRes.status).toBeLessThan(500);
      if (readRes.ok) {
        const contentType = readRes.headers.get('content-type') ?? '';
        if (contentType.includes('json')) {
          const data = await readRes.json();
          const saveRes = await fetch('http://localhost:5175/__admin_save?file=decisions.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          expect(saveRes.ok).toBe(true);
        }
      }
    });
  });
});
