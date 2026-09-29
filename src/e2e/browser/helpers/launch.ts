// src/e2e/browser/helpers/launch.ts
// Reusable Playwright browser launch, loading screen dismissal, and screen navigation.
// Extracted from scripts/inspect.js patterns.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Viewport } from './viewports.js';
import { VIEWPORTS } from './viewports.js';

const DEV_SERVER_URL = 'http://localhost:5173';

/** Screens that can be navigated to via button click after loading. */
const SCREEN_NAV: Record<string, {
  selector: string | null;
  waitFor: string;
  postNav?: (page: Page) => Promise<void>;
}> = {
  menu:        { selector: null,            waitFor: '#menu-buttons' },
  settings:    { selector: '#btn-settings', waitFor: '#settings-overlay:not(.hidden)' },
  social:      { selector: '#btn-social',   waitFor: '#social-overlay:not(.hidden)' },
  stats:       { selector: '#btn-stats',    waitFor: '#stats-overlay:not(.hidden)' },
  leaderboard: {
    selector: '#btn-stats',
    waitFor: '#stats-overlay:not(.hidden)',
    async postNav(page) {
      await page.click('.stats-view-tab[data-view="leaderboard"]');
      await page.waitForSelector('#stats-panel-leaderboard', { state: 'visible', timeout: 5000 });
    },
  },
  music:  { selector: '#btn-music',  waitFor: '#music-overlay:not(.hidden)' },
  auth:   { selector: '#btn-login',  waitFor: '#login-overlay:not(.hidden)' },
};

export type ScreenName = keyof typeof SCREEN_NAV;
export const NAVIGABLE_SCREENS = Object.keys(SCREEN_NAV) as ScreenName[];

/** Overlay screens that have .content containers to test for containment. */
export const OVERLAY_SCREENS: ScreenName[] = ['settings', 'social', 'stats', 'music', 'auth'];

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Launch Chromium for browser tests.
 * - Headless mode uses SwiftShader (software GPU) for CI environments.
 * - Headed mode uses the real GPU to avoid grey-screen rendering issues.
 */
export async function launchBrowser(
  viewport: Viewport = VIEWPORTS.desktop,
  options?: { headless?: boolean },
): Promise<BrowserSession> {
  const headless = options?.headless ?? true;
  const args = headless
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl']
    : ['--enable-webgl'];
  const browser = await chromium.launch({ headless, args });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/** Navigate to the game and dismiss the loading screen. Waits for main menu. */
export async function dismissLoading(page: Page): Promise<void> {
  await page.goto(DEV_SERVER_URL, { waitUntil: 'commit', timeout: 30_000 });
  await dismissLoadingScreen(page);
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
}

/**
 * Dismiss the loading screen on a page that has already navigated.
 * Does NOT wait for any specific post-loading screen — the caller
 * decides what to wait for (menu-buttons, lobby-overlay, etc.).
 */
export async function dismissLoadingScreen(page: Page): Promise<void> {
  await page.waitForSelector('#click-prompt.click-prompt--visible', { timeout: 90_000 });

  // Click multiple ways to ensure the loading screen dismisses
  await page.locator('#loading-screen').click({ force: true });
  await page.waitForTimeout(300);

  // Fallback: JS click directly on the loading screen element
  await page.evaluate(() => {
    const el = document.getElementById('loading-screen');
    if (el) el.click();
    // Also dispatch a pointer event in case click listeners are on document
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  // Wait for the loading screen to actually disappear
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-screen');
    if (!el) return true;
    const style = window.getComputedStyle(el);
    return style.display === 'none' || style.opacity === '0' ||
      el.classList.contains('loading-screen--fade-out') ||
      el.classList.contains('hidden');
  }, { timeout: 10_000 }).catch(() => {
    // Last resort: force-hide via JS
    page.evaluate(() => {
      const el = document.getElementById('loading-screen');
      if (el) el.style.display = 'none';
    });
  });

  // Brief settle for post-loading screen transitions
  await page.waitForTimeout(500);
}

/** Navigate to a named screen from the main menu. */
export async function navigateToScreen(page: Page, screen: ScreenName): Promise<void> {
  const nav = SCREEN_NAV[screen];
  if (!nav) throw new Error(`Unknown screen: ${screen}`);
  if (nav.selector) {
    // Try click first; if it fails (e.g. topbar pointer-events), use JS click
    try {
      await page.click(nav.selector, { timeout: 3000 });
    } catch {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) el.click();
      }, nav.selector);
    }
  }
  await page.waitForSelector(nav.waitFor, { state: 'visible', timeout: 8000 });
  if (nav.postNav) {
    await nav.postNav(page);
  }
}

/** Return to the main menu using direct DOM manipulation.
 *  Also fires Escape so navigation.ts's currentScreen state resets — otherwise
 *  a subsequent navigateTo('settings') would early-return because
 *  `screen === currentScreen` (state is out of sync with DOM). */
export async function returnToMenu(page: Page): Promise<void> {
  // Drain the navigation stack back to 'main' via the same keypath users take.
  // Spamming Escape is a no-op once we're on main, so a few fires is safe.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }

  await page.evaluate(() => {
    // Hide all overlay-screen elements
    document.querySelectorAll('.overlay-screen').forEach(el => {
      el.classList.add('hidden');
    });
    // Show the main menu overlay (#overlay) and ensure visibility
    const main = document.getElementById('overlay');
    if (main) {
      main.classList.remove('hidden');
      // overlay-screen.hidden sets visibility:hidden, so explicitly clear it
      main.style.visibility = 'visible';
      main.style.pointerEvents = '';
      // Also ensure .content inside is visible
      const content = main.querySelector('.content') as HTMLElement | null;
      if (content) {
        content.style.opacity = '1';
        content.style.transform = 'scale(1)';
      }
    }
  });
  // Wait a tick for reflow
  await page.waitForTimeout(100);
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 8000 });
}
