// src/e2e/browser/admin/admin-dev-infra.test.ts
// E2E tests: Dev & infrastructure — git, file browser, test center,
// e2e matrix, audits.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection } from './helpers';

describe('Dev & Infrastructure Sections', () => {
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

  // ── Git ──────────────────────────────────────────────────

  describe('Git section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'git');
      await page.waitForTimeout(800);
    });

    it('renders the git section with content', async () => {
      await page.waitForFunction(() => {
        const el = document.getElementById('section-git');
        return (el?.textContent?.length ?? 0) > 5;
      }, { timeout: 5000 });
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-git');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/git|branch|commit|diff/);
    });

    it('git status API returns valid data', async () => {
      const res = await fetch('http://localhost:5175/__admin_git/status');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('branch');
    });

    it('git log API returns commits', async () => {
      const res = await fetch('http://localhost:5175/__admin_git/log?limit=5');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('commits');
      expect(data.commits.length).toBeGreaterThan(0);
    });

    it('git branches API returns branches', async () => {
      const res = await fetch('http://localhost:5175/__admin_git/branches');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('branches');
      expect(Array.isArray(data.branches)).toBe(true);
      expect(data.branches.length).toBeGreaterThan(0);
      expect(data.branches[0]).toHaveProperty('name');
    });

    it('git diff API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_git/diff');
      expect(res.ok).toBe(true);
    });

    it('git section is in the DOM', async () => {
      const exists = await page.evaluate(() =>
        !!document.getElementById('section-git')
      );
      expect(exists).toBe(true);
    });
  });

  // ── File Browser ─────────────────────────────────────────

  describe('File Browser section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'file-browser');
      await page.waitForTimeout(800);
    });

    it('renders the file browser section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-file-browser');
        return el?.textContent ?? '';
      });
      expect(text.length).toBeGreaterThan(0);
    });

    it('file list API returns directory entries', async () => {
      const res = await fetch('http://localhost:5175/__admin_fs/list?path=.');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Should include common project files/dirs
      const names = data.map((e: { name: string }) => e.name);
      expect(names).toContain('src');
    });

    it('file read API can read a file', async () => {
      const res = await fetch('http://localhost:5175/__admin_fs/read?path=package.json');
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('content');
      expect(data.content).toContain('luminal');
    });
  });

  // ── Test Center ──────────────────────────────────────────

  describe('Test Center section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'test-center');
      await page.waitForTimeout(600);
    });

    it('renders the test center section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-test-center');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toMatch(/test|runner|suite/);
    });

    it('test log data is accessible', async () => {
      const res = await fetch('http://localhost:5175/data/test-log.json');
      // May 404 if no test runs yet
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── E2E Matrix ───────────────────────────────────────────

  describe('E2E Matrix section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'e2e-matrix');
      await page.waitForTimeout(600);
    });

    it('renders the e2e matrix section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-e2e-matrix');
        return el?.textContent ?? '';
      });
      expect(text.length).toBeGreaterThan(0);
    });

    it('e2e matrix API returns data', async () => {
      const res = await fetch('http://localhost:5175/__admin_e2e_matrix');
      if (res.ok) {
        const data = await res.json();
        expect(data).toBeTruthy();
      } else {
        // 404 if no matrix file yet — acceptable
        expect(res.status).toBeLessThan(500);
      }
    });
  });

  // ── Audits ───────────────────────────────────────────────

  describe('Audits section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'audits');
      await page.waitForTimeout(600);
    });

    it('renders the audits section', async () => {
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-audits');
        return el?.textContent ?? '';
      });
      expect(text.toLowerCase()).toMatch(/audit|hygiene|coverage/);
    });

    it('audits data is accessible', async () => {
      const res = await fetch('http://localhost:5175/data/audits.json');
      expect(res.status).toBeLessThan(500);
    });
  });
});
