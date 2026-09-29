// src/e2e/browser/loadout-carousel.test.ts
// TASK-182 — Verify loadout carousel scrolls correctly when selecting
// the first (leftmost) and last (rightmost) vehicle cards.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  launchBrowser, dismissLoading,
  type BrowserSession,
} from './helpers/index.js';
import { setupFailureCapture } from './helpers/index.js';
import { VIEWPORTS, type Viewport } from './helpers/index.js';

let session: BrowserSession;

const capture = setupFailureCapture(
  () => session?.page,
  () => session?.context,
);

beforeAll(async () => {
  session = await launchBrowser(VIEWPORTS.desktop);
}, 15_000);

afterAll(async () => {
  await session?.browser.close();
});

beforeEach(capture.before);
afterEach(capture.after);

/** Full page reload + navigate to loadout. Ensures clean state per test. */
async function freshLoadout(viewport?: Viewport): Promise<void> {
  const page = session.page;
  if (viewport) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
  }
  await page.goto('http://localhost:5173', { waitUntil: 'commit', timeout: 30_000 });
  // Clear vehicle selection so bike is default
  await page.evaluate(() => localStorage.removeItem('luminal-vehicle'));
  await page.reload({ waitUntil: 'commit' });
  await dismissLoading(page);
  // Open loadout
  await page.evaluate(() => document.getElementById('btn-character-select')?.click());
  await page.waitForSelector('#character-select-overlay:not(.hidden)', {
    state: 'visible',
    timeout: 8000,
  });
  await page.waitForTimeout(600);
}

/**
 * Select a vehicle card, wait for scroll to complete, then measure visibility.
 */
async function selectAndMeasure(vehicleId: string): Promise<{
  fullyVisible: boolean;
  cardLeft: number;
  cardRight: number;
  carouselLeft: number;
  carouselRight: number;
}> {
  const page = session.page;

  // Click the card via game's own handler
  await page.evaluate((vid) => {
    document.getElementById(`cs-card-${vid}`)?.click();
  }, vehicleId);

  // Wait for smooth scroll + transform animation to settle
  await page.waitForTimeout(1200);

  return page.evaluate((vid) => {
    const card = document.getElementById(`cs-card-${vid}`);
    const carousel = document.getElementById('cs-carousel');
    if (!card || !carousel) {
      return { fullyVisible: false, cardLeft: 0, cardRight: 0, carouselLeft: 0, carouselRight: 0 };
    }
    const cr = card.getBoundingClientRect();
    const vr = carousel.getBoundingClientRect();
    return {
      fullyVisible: cr.left >= vr.left - 2 && cr.right <= vr.right + 2,
      cardLeft: Math.round(cr.left),
      cardRight: Math.round(cr.right),
      carouselLeft: Math.round(vr.left),
      carouselRight: Math.round(vr.right),
    };
  }, vehicleId);
}

describe('loadout carousel scroll', () => {
  it('clicking BACK hides the loadout overlay', async () => {
    // Loadout now auto-saves (cs-saved toast replaced the explicit SAVE button).
    // Exit is via the hub-back chevron — the overlay must still dismiss cleanly.
    await freshLoadout();
    const page = session.page;

    // Verify overlay is visible
    const isVisibleBefore = await page.evaluate(
      () => !document.getElementById('character-select-overlay')!.classList.contains('hidden'),
    );
    expect(isVisibleBefore).toBe(true);

    // Click BACK (hub-back chevron)
    await page.evaluate(() => document.getElementById('hub-back')!.click());

    // Wait for the hide transition
    await page.waitForTimeout(400);

    const isHidden = await page.evaluate(
      () => document.getElementById('character-select-overlay')!.classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);
  });

  describe('desktop (1920x1080)', () => {
    it('first card (bike) scrolls fully into view after selecting from the right', async () => {
      await freshLoadout(VIEWPORTS.desktop);

      // Select rightmost card first to scroll right
      await selectAndMeasure('hoverboard');

      // Now select leftmost — the reported bug: first card not scrolled into view
      const result = await selectAndMeasure('bike');
      expect(result.fullyVisible).toBe(true);
      expect(result.cardLeft).toBeGreaterThanOrEqual(result.carouselLeft - 2);
    }, 60_000);

    it('last card (hoverboard) scrolls fully into view from the left', async () => {
      await freshLoadout(VIEWPORTS.desktop);

      // Default is bike (leftmost) — select hoverboard (rightmost)
      const result = await selectAndMeasure('hoverboard');
      expect(result.fullyVisible).toBe(true);
      expect(result.cardRight).toBeLessThanOrEqual(result.carouselRight + 2);
    }, 60_000);

    it('middle card (car) is visible when selected', async () => {
      await freshLoadout(VIEWPORTS.desktop);

      const result = await selectAndMeasure('car');
      expect(result.fullyVisible).toBe(true);
    }, 60_000);
  });

  describe('tablet (768x1024)', () => {
    it('first card (bike) scrolls into view on tablet', async () => {
      await freshLoadout(VIEWPORTS.tablet);
      await selectAndMeasure('hoverboard');

      const result = await selectAndMeasure('bike');
      expect(result.fullyVisible).toBe(true);
    }, 60_000);

    it('last card (hoverboard) scrolls into view on tablet', async () => {
      await freshLoadout(VIEWPORTS.tablet);

      const result = await selectAndMeasure('hoverboard');
      expect(result.fullyVisible).toBe(true);
    }, 60_000);
  });
});
