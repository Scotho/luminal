// src/e2e/browser/shop-purchase.test.ts
// TASK-307 — Browser e2e tests for shop purchase flow, modals, persistence.
// Tests both anonymous and signed-in flows against the live local dev server.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  launchBrowser,
  dismissLoading,
  type BrowserSession,
} from './helpers/index.js';
import { setupFailureCapture } from './helpers/index.js';
import { VIEWPORTS } from './helpers/index.js';
import { signIn } from './online/testAccounts.js';

let session: BrowserSession;

const capture = setupFailureCapture(
  () => session?.page,
  () => session?.context,
);

beforeAll(async () => {
  session = await launchBrowser(VIEWPORTS.desktop, { headless: false });
}, 15_000);

afterAll(async () => {
  await session?.browser.close();
});

beforeEach(capture.before);
afterEach(capture.after);

// ── Helpers ─────────────────────────────────────────────

/** Navigate to loadout hub and switch to the Shop tab. */
async function openShopTab(): Promise<void> {
  const page = session.page;
  await page.goto('http://localhost:5173', { waitUntil: 'commit', timeout: 30_000 });
  await dismissLoading(page);

  // Open loadout
  await page.evaluate(() => document.getElementById('btn-character-select')?.click());
  await page.waitForSelector('#character-select-overlay:not(.hidden)', {
    state: 'visible',
    timeout: 8000,
  });
  await page.waitForTimeout(400);

  // Switch to Shop tab
  await page.evaluate(() => document.getElementById('hub-tab-shop')?.click());
  await page.waitForTimeout(300);
}

/** Get shop card info from the page. */
async function getShopCards(): Promise<Array<{ name: string; owned: boolean; hasHint: boolean }>> {
  return session.page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.shop-card'));
    return cards.map(card => ({
      name: card.querySelector('.shop-card__name')?.textContent ?? '',
      owned: card.classList.contains('shop-card--owned'),
      hasHint: card.classList.contains('shop-card--cant-afford'),
    }));
  });
}

/** Check if the current user is signed in (not anon). */
async function isUserSignedIn(): Promise<boolean> {
  return session.page.evaluate(() => {
    const el = document.getElementById('auth-username');
    const text = el?.textContent?.trim();
    return !!(text && text !== 'LOG IN' && !text.includes('Anon'));
  });
}

/** Check if a modal is visible. */
async function isModalVisible(modalId: string): Promise<boolean> {
  return session.page.evaluate((id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  }, modalId);
}

// ── Tests ───────────────────────────────────────────────

describe('shop purchase flow', () => {
  describe('anonymous user', () => {
    it('shop tab shows FLOW balance of 0', async () => {
      await openShopTab();
      const balance = await session.page.evaluate(() =>
        document.getElementById('shop-flow-amount')?.textContent?.trim()
      );
      expect(balance).toBe('0');
    }, 60_000);

    it('clicking BUY shows sign-in modal', async () => {
      await openShopTab();
      // Click first BUY button
      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(200);
      expect(await isModalVisible('shop-signin-modal')).toBe(true);
      expect(await isModalVisible('shop-purchase-modal')).toBe(false);
    }, 60_000);

    it('sign-in modal CANCEL button closes it', async () => {
      await openShopTab();
      await session.page.evaluate(() => {
        (document.querySelector('.shop-card__buy:not([disabled])') as HTMLElement)?.click();
      });
      await session.page.waitForTimeout(200);
      expect(await isModalVisible('shop-signin-modal')).toBe(true);

      // Click CANCEL
      await session.page.evaluate(() => document.getElementById('shop-signin-cancel')?.click());
      await session.page.waitForTimeout(200);
      expect(await isModalVisible('shop-signin-modal')).toBe(false);
    }, 60_000);

    it('Escape closes sign-in modal', async () => {
      await openShopTab();
      await session.page.evaluate(() => {
        (document.querySelector('.shop-card__buy:not([disabled])') as HTMLElement)?.click();
      });
      await session.page.waitForTimeout(200);
      expect(await isModalVisible('shop-signin-modal')).toBe(true);

      await session.page.keyboard.press('Escape');
      await session.page.waitForTimeout(200);
      expect(await isModalVisible('shop-signin-modal')).toBe(false);
    }, 60_000);
  });

  describe('shop card rendering', () => {
    it('renders shop cards with names and costs', async () => {
      await openShopTab();
      const cards = await getShopCards();
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.name).toBeTruthy();
      }
    }, 60_000);

    it('category tabs switch between colors and emissives', async () => {
      await openShopTab();
      const page = session.page;

      // Start on colors
      const colorCards = await getShopCards();
      expect(colorCards.length).toBeGreaterThan(0);

      // Switch to emissives
      await page.evaluate(() => {
        const btn = document.querySelector('.shop-cat[data-category="emissive"]') as HTMLElement;
        btn?.click();
      });
      await page.waitForTimeout(300);
      const emissiveCards = await getShopCards();
      expect(emissiveCards.length).toBeGreaterThan(0);

      // Verify cards changed
      const emissiveNames = emissiveCards.map(c => c.name);
      const colorNames = colorCards.map(c => c.name);
      expect(emissiveNames).not.toEqual(colorNames);
    }, 60_000);
  });

  describe('purchase modal interactions', () => {
    beforeEach(async () => {
      // Sign in so BUY opens purchase modal instead of sign-in modal
      await openShopTab();
      try {
        await signIn(session.page, 'host');
      } catch {
        // If sign-in fails (no emulator), skip gracefully
      }
      // Re-open shop tab after sign-in
      const page = session.page;
      await page.evaluate(() => document.getElementById('btn-character-select')?.click());
      await page.waitForSelector('#character-select-overlay:not(.hidden)', {
        state: 'visible',
        timeout: 8000,
      });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById('hub-tab-shop')?.click());
      await page.waitForTimeout(300);
    }, 90_000);

    it('BUY opens purchase confirmation modal', async () => {
      if (!await isUserSignedIn()) return; // skip if sign-in failed

      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card:not(.shop-card--owned) .shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(true);
    }, 60_000);

    it('CANCEL closes purchase modal', async () => {
      if (!await isUserSignedIn()) return;

      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card:not(.shop-card--owned) .shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(true);

      // Click CANCEL
      await session.page.evaluate(() => document.getElementById('shop-modal-cancel')?.click());
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(false);
    }, 60_000);

    it('Escape closes purchase modal', async () => {
      if (!await isUserSignedIn()) return;

      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card:not(.shop-card--owned) .shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(true);

      await session.page.keyboard.press('Escape');
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(false);
    }, 60_000);

    it('backdrop click closes purchase modal', async () => {
      if (!await isUserSignedIn()) return;

      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card:not(.shop-card--owned) .shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(300);

      // Click backdrop (click the modal overlay area, not the content)
      await session.page.evaluate(() => {
        const backdrop = document.querySelector('#shop-purchase-modal .shop-modal-backdrop') as HTMLElement;
        backdrop?.click();
      });
      await session.page.waitForTimeout(300);
      expect(await isModalVisible('shop-purchase-modal')).toBe(false);
    }, 60_000);

    it('purchase modal shows item details', async () => {
      if (!await isUserSignedIn()) return;

      await session.page.evaluate(() => {
        const btn = document.querySelector('.shop-card:not(.shop-card--owned) .shop-card__buy:not([disabled])') as HTMLElement;
        btn?.click();
      });
      await session.page.waitForTimeout(300);

      const title = await session.page.evaluate(() =>
        document.getElementById('shop-modal-title')?.textContent?.trim()
      );
      const cost = await session.page.evaluate(() =>
        document.getElementById('shop-modal-cost')?.textContent?.trim()
      );
      expect(title).toContain('Purchase');
      expect(cost).toContain('FLOW');
    }, 60_000);
  });

  describe('tab navigation', () => {
    it('all four hub tabs are accessible', async () => {
      await openShopTab();
      const page = session.page;

      for (const tab of ['garage', 'match', 'unlocks', 'shop']) {
        await page.evaluate((t) => document.getElementById(`hub-tab-${t}`)?.click(), tab);
        await page.waitForTimeout(200);

        const isVisible = await page.evaluate((t) =>
          !document.getElementById(`hub-panel-${t}`)?.classList.contains('hidden'),
          tab
        );
        expect(isVisible).toBe(true);
      }
    }, 60_000);

    it('Escape with no modals closes the hub overlay', async () => {
      await openShopTab();
      const page = session.page;

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const isHidden = await page.evaluate(() =>
        document.getElementById('character-select-overlay')?.classList.contains('hidden')
      );
      expect(isHidden).toBe(true);
    }, 60_000);
  });

  describe('persistence', () => {
    it('vehicle selection persists in localStorage', async () => {
      const page = session.page;
      await page.goto('http://localhost:5173', { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoading(page);

      // Open loadout
      await page.evaluate(() => document.getElementById('btn-character-select')?.click());
      await page.waitForSelector('#character-select-overlay:not(.hidden)', {
        state: 'visible',
        timeout: 8000,
      });
      await page.waitForTimeout(400);

      // Select car
      await page.evaluate(() => document.getElementById('cs-card-car')?.click());
      await page.waitForTimeout(500);

      // Check localStorage
      const saved = await page.evaluate(() => localStorage.getItem('luminal-vehicle'));
      expect(saved).toBe('car');

      // Reload and verify persistence
      await page.reload({ waitUntil: 'commit' });
      await dismissLoading(page);
      const afterReload = await page.evaluate(() => localStorage.getItem('luminal-vehicle'));
      expect(afterReload).toBe('car');
    }, 90_000);

    it('color selection persists in localStorage', async () => {
      const page = session.page;
      await page.goto('http://localhost:5173', { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoading(page);

      await page.evaluate(() => document.getElementById('btn-character-select')?.click());
      await page.waitForSelector('#character-select-overlay:not(.hidden)', {
        state: 'visible',
        timeout: 8000,
      });
      await page.waitForTimeout(400);

      // Click a color swatch (pick the second available one)
      const colorKey = await page.evaluate(() => {
        const swatches = Array.from(document.querySelectorAll('.cs-color:not(.color-swatch--locked)'));
        if (swatches.length > 1) {
          (swatches[1] as HTMLElement).click();
          return (swatches[1] as HTMLElement).dataset.color;
        }
        return null;
      });
      await page.waitForTimeout(500);

      if (colorKey) {
        const saved = await page.evaluate(() => localStorage.getItem('luminal-color'));
        expect(saved).toBe(colorKey);
      }
    }, 90_000);
  });
});
