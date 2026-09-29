// src/e2e/browser/admin/admin-utilities.test.ts
// E2E tests: Utility sections — impact analysis, memory economy,
// chat moderation, purge, viewer, match replay, analytics, users,
// leaderboard, matches, playtime, firebase metrics.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection, sectionExists } from './helpers';

describe('Utility & Data Sections', () => {
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

  // ── Impact Analysis ──────────────────────────────────────

  describe('Impact Analysis section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'impact-analysis');
      await page.waitForTimeout(600);
    });

    it('renders impact analysis section', async () => {
      expect(await sectionExists(page, 'impact-analysis')).toBe(true);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-impact-analysis');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/impact|module|depend/);
    });
  });

  // ── Memory & Token Economy ───────────────────────────────

  describe('Memory Economy section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'memory-economy');
      await page.waitForTimeout(600);
    });

    it('renders memory economy section', async () => {
      expect(await sectionExists(page, 'memory-economy')).toBe(true);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-memory-economy');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/memory|token|economy/);
    });
  });

  // ── Chat Moderation ──────────────────────────────────────

  describe('Chat Moderation section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'chat-moderation');
      await page.waitForTimeout(500);
    });

    it('renders chat moderation section', async () => {
      expect(await sectionExists(page, 'chat-moderation')).toBe(true);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-chat-moderation');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/chat|moderat|filter|queue/);
    });
  });

  // ── Purge / Admin Actions ────────────────────────────────

  describe('Purge section', () => {
    beforeAll(async () => {
      await navigateToSection(page, 'purge');
      await page.waitForTimeout(500);
    });

    it('renders purge section', async () => {
      expect(await sectionExists(page, 'purge')).toBe(true);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-purge');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/purge|admin|action|config|export/);
    });
  });

  // ── 3D Viewer ────────────────────────────────────────────

  describe('Viewer section', () => {
    it('viewer section container exists', async () => {
      expect(await sectionExists(page, 'viewer')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'viewer');
      await page.waitForTimeout(500);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-viewer');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/viewer|model|vehicle|bike/);
    });
  });

  // ── Match Replay ─────────────────────────────────────────

  describe('Match Replay section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'match-replay')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'match-replay');
      await page.waitForTimeout(500);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-match-replay');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/replay|match/);
    });
  });

  // ── Analytics ────────────────────────────────────────────

  describe('Analytics section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'analytics')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'analytics');
      await page.waitForTimeout(500);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-analytics');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/analytic|map|usage|budget/);
    });
  });

  // ── Users ────────────────────────────────────────────────

  describe('Users section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'users')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'users');
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-users');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/user|player|load/);
    });
  });

  // ── Leaderboard ──────────────────────────────────────────

  describe('Leaderboard section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'leaderboard')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'leaderboard');
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-leaderboard');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/leaderboard|rank|load/);
    });
  });

  // ── Matches ──────────────────────────────────────────────

  describe('Matches section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'matches')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'matches');
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-matches');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/match|history|load/);
    });
  });

  // ── Playtime ─────────────────────────────────────────────

  describe('Playtime section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'playtime')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'playtime');
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-playtime');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/playtime|time|load/);
    });
  });

  // ── Firebase Metrics ─────────────────────────────────────

  describe('Firebase Metrics section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'firebase-metrics')).toBe(true);
    });

    it('renders when navigated to', async () => {
      await navigateToSection(page, 'firebase-metrics');
      await page.waitForFunction(() => {
        const el = document.getElementById('section-firebase-metrics');
        return (el?.textContent?.length ?? 0) > 5;
      }, { timeout: 5000 });
      const text = await page.evaluate(() => {
        const el = document.getElementById('section-firebase-metrics');
        return el?.textContent?.toLowerCase() ?? '';
      });
      expect(text).toMatch(/firebase|metric|read|write/);
    });

    it('firebase metrics API responds', async () => {
      const res = await fetch('http://localhost:5175/__admin_exec/firebase-metrics');
      expect(res.ok).toBe(true);
    });
  });

  // ── Live Diff ────────────────────────────────────────────

  describe('Live Diff section', () => {
    it('section container exists', async () => {
      expect(await sectionExists(page, 'live-diff')).toBe(true);
    });
  });
});
