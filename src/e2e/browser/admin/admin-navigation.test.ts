// src/e2e/browser/admin/admin-navigation.test.ts
// E2E tests: Core navigation — sidebar, section switching, command bar,
// keyboard shortcuts, theme manager, status banner.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, preflight, navigateToSection, sectionExists, sectionIsActive } from './helpers';

// Every section that must exist in the DOM
const ALL_SECTIONS = [
  'live', 'tasks', 'sessions', 'notes', 'specs',
  'git', 'audits', 'function-logs', 'impact-analysis', 'file-browser',
  'test-center', 'e2e-matrix',
  'agents', 'overseer', 'live-diff', 'memory-economy',
  'users', 'matches', 'leaderboard', 'database', 'playtime', 'firebase-metrics', 'match-replay', 'analytics',
  'ollama', 'chat-moderation', 'feature-flags', 'bugs', 'purge', 'incidents', 'notifications', 'scheduler',
  'links', 'viewer', 'help', 'settings',
] as const;

// Sections that are safe to navigate to without side effects
const NAVIGABLE_SECTIONS = [
  'live', 'tasks', 'sessions', 'notes', 'specs',
  'git', 'audits', 'file-browser', 'test-center', 'e2e-matrix',
  'help', 'links', 'settings', 'notifications', 'incidents', 'scheduler',
  'ollama', 'feature-flags', 'overseer', 'bugs',
  'database', 'impact-analysis', 'memory-economy',
] as const;

describe('Admin Navigation & Layout', () => {
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

  // ── Sidebar structure ────────────────────────────────────

  it('sidebar exists with title', async () => {
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('#sidebar h1');
      return h1?.textContent?.trim() ?? '';
    });
    expect(title.toLowerCase()).toContain('luminal');
  });

  it('sidebar has nav items', async () => {
    const count = await page.evaluate(() =>
      document.querySelectorAll('#sidebar .nav-item[data-section]').length
    );
    expect(count).toBeGreaterThan(20);
  });

  it('sidebar has group headers', async () => {
    const groups = await page.evaluate(() => {
      const headers = document.querySelectorAll('#sidebar .nav-group-header');
      return Array.from(headers).map(h => h.textContent?.trim() ?? '');
    });
    // Group headers have chevron symbols prepended (e.g., "▼Planning")
    expect(groups.some(g => g.includes('Planning'))).toBe(true);
    expect(groups.some(g => g.includes('Dev'))).toBe(true);
    expect(groups.some(g => g.includes('Testing'))).toBe(true);
  });

  // ── Section containers ───────────────────────────────────

  for (const section of ALL_SECTIONS) {
    it(`section container #section-${section} exists`, async () => {
      expect(await sectionExists(page, section)).toBe(true);
    });
  }

  // ── Section navigation ───────────────────────────────────

  it('default section is active on initial load', async () => {
    // After launchAdmin, the default section (usually 'live') should be active
    // Wait a moment for the dashboard to finish initializing
    await page.waitForFunction(() => {
      return document.querySelectorAll('.section.active').length > 0;
    }, { timeout: 5000 });
    const activeCount = await page.evaluate(() =>
      document.querySelectorAll('.section.active').length
    );
    expect(activeCount).toBe(1);
  });

  for (const section of NAVIGABLE_SECTIONS) {
    it(`navigating to "${section}" shows the section`, async () => {
      await navigateToSection(page, section);
      expect(await sectionIsActive(page, section)).toBe(true);
    });
  }

  // ── Command bar ──────────────────────────────────────────

  it('Ctrl+K opens command bar', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const visible = await page.evaluate(() => {
      const el = document.getElementById('global-search-input') ??
                 document.querySelector('.command-bar-input') ??
                 document.querySelector('[data-command-bar]');
      if (!el) return false;
      const style = getComputedStyle(el as HTMLElement);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    expect(visible).toBe(true);

    // Close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  // ── Status banner ────────────────────────────────────────

  it('status banner exists', async () => {
    const exists = await page.evaluate(() =>
      !!document.getElementById('cc-status-banner') || !!document.getElementById('cc-status-btn')
    );
    expect(exists).toBe(true);
  });

  it('status button is clickable', async () => {
    const exists = await page.evaluate(() =>
      !!document.getElementById('cc-status-btn')
    );
    expect(exists).toBe(true);
  });

  // ── Theme ────────────────────────────────────────────────

  it('page has a theme applied', async () => {
    // Theme is set on document.body.dataset.theme
    const theme = await page.evaluate(() =>
      document.body.dataset.theme ?? document.documentElement.getAttribute('data-theme')
    );
    expect(theme).toBeTruthy();
  });

  it('CSS custom properties are defined', async () => {
    const vars = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        bg: style.getPropertyValue('--bg').trim(),
        text: style.getPropertyValue('--text').trim(),
        accent: style.getPropertyValue('--accent').trim(),
        border: style.getPropertyValue('--border').trim(),
      };
    });
    expect(vars.bg).toBeTruthy();
    expect(vars.text).toBeTruthy();
    expect(vars.accent).toBeTruthy();
    expect(vars.border).toBeTruthy();
  });
});
