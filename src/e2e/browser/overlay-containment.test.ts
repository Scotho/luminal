// src/e2e/browser/overlay-containment.test.ts
// P0 — Verify overlay .content elements stay within viewport bounds at all breakpoints.
// Catches: height/layout overflow (Cat 1), settings layout (Cat 5), CSS specificity (Cat 9).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  launchBrowser, dismissLoading, dismissLoadingScreen, navigateToScreen, returnToMenu,
  type BrowserSession, type ScreenName,
} from './helpers/index.js';
import {
  getBounds, hasHorizontalScrollbar, getComputedProp, getViewportSize,
} from './helpers/index.js';
import { ALL_VIEWPORTS, TOPBAR_HEIGHT, type Viewport } from './helpers/index.js';
import { setupFailureCapture } from './helpers/index.js';

const STANDARD_OVERLAYS: ScreenName[] = ['social', 'stats', 'music', 'auth'];

let session: BrowserSession;

const capture = setupFailureCapture(
  () => session?.page,
  () => session?.context,
);

beforeAll(async () => {
  session = await launchBrowser();
  await dismissLoading(session.page);
}, 30_000);

afterAll(async () => {
  await session?.browser.close();
});

beforeEach(capture.before);
afterEach(capture.after);

describe.each(ALL_VIEWPORTS)('overlay containment @ $label ($width x $height)', (viewport: Viewport) => {
  beforeAll(async () => {
    await session.page.setViewportSize({ width: viewport.width, height: viewport.height });
    // Reload instead of DOM-manipulating back to menu — returnToMenu() is fragile
    // at phone/tablet viewports when prior tests leave the page in a bad state.
    await session.page.reload({ waitUntil: 'commit' });
    await dismissLoadingScreen(session.page);
    await session.page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
  }, 35_000);

  describe.each(STANDARD_OVERLAYS)('%s overlay', (screen: ScreenName) => {
    beforeAll(async () => {
      await returnToMenu(session.page);
      await navigateToScreen(session.page, screen);
      await session.page.waitForTimeout(350);
    }, 15_000);

    it('content bottom does not exceed viewport height', async () => {
      const bounds = await getBounds(session.page, `#${getOverlayId(screen)} .content`);
      const vp = await getViewportSize(session.page);
      expect(bounds).not.toBeNull();
      expect(bounds!.bottom).toBeLessThanOrEqual(vp.height + 1);
    });

    it('content right does not exceed viewport width', async () => {
      const bounds = await getBounds(session.page, `#${getOverlayId(screen)} .content`);
      const vp = await getViewportSize(session.page);
      expect(bounds).not.toBeNull();
      expect(bounds!.right).toBeLessThanOrEqual(vp.width + 1);
    });

    it('content top is at or below topbar', async () => {
      const bounds = await getBounds(session.page, `#${getOverlayId(screen)} .content`);
      expect(bounds).not.toBeNull();
      expect(bounds!.top).toBeGreaterThanOrEqual(TOPBAR_HEIGHT - 1);
    });

    it('no horizontal scrollbar', async () => {
      expect(await hasHorizontalScrollbar(session.page)).toBe(false);
    });
  });

  describe('settings overlay', () => {
    beforeAll(async () => {
      await returnToMenu(session.page);
      await navigateToScreen(session.page, 'settings');
      await session.page.waitForTimeout(350);
    }, 15_000);

    it('settings page fits within viewport height', async () => {
      const bounds = await getBounds(session.page, '#settings-overlay');
      const vp = await getViewportSize(session.page);
      expect(bounds).not.toBeNull();
      expect(bounds!.bottom).toBeLessThanOrEqual(vp.height + 1);
    });

    it('settings page top is positioned correctly', async () => {
      const bounds = await getBounds(session.page, '#settings-overlay');
      expect(bounds).not.toBeNull();
      if (viewport.width > 768) {
        // Desktop: top offset by topbar height (inset:0 + top:40px from overlay-screen)
        expect(bounds!.top).toBeGreaterThanOrEqual(TOPBAR_HEIGHT - 1);
      } else {
        // Mobile: full-screen with height:100vh and padding-top for topbar
        expect(bounds!.top).toBe(0);
      }
    });

    it('settings content body is scrollable (overflow-y: auto)', async () => {
      const overflow = await getComputedProp(session.page, '#settings-content-body', 'overflow-y');
      expect(overflow).toBe('auto');
    });

    it('no horizontal scrollbar', async () => {
      expect(await hasHorizontalScrollbar(session.page)).toBe(false);
    });

    if (viewport.width <= 768) {
      it('settings sidebar uses horizontal tabs on mobile', async () => {
        const flexDir = await getComputedProp(session.page, '.settings-sidebar-nav', 'flex-direction');
        expect(flexDir).toBe('row');
      });
    }

    if (viewport.width > 768) {
      it('settings sidebar is ~240px wide on desktop (240px + border)', async () => {
        const bounds = await getBounds(session.page, '.settings-sidebar');
        expect(bounds).not.toBeNull();
        // 240px min-width + 1px border-right; padding may add a few pixels
        expect(bounds!.width).toBeGreaterThanOrEqual(240);
        expect(bounds!.width).toBeLessThanOrEqual(260);
      });
    }
  });

  describe('auth overlay content width', () => {
    beforeAll(async () => {
      await returnToMenu(session.page);
      await navigateToScreen(session.page, 'auth');
      await session.page.waitForTimeout(350);
    }, 15_000);

    it('auth form does not exceed viewport width', async () => {
      const bounds = await getBounds(session.page, '#login-overlay .content');
      const vp = await getViewportSize(session.page);
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeLessThanOrEqual(vp.width + 1);
    });

    if (viewport.width <= 480) {
      it('auth panel uses near-full-width on small phones', async () => {
        const bounds = await getBounds(session.page, '#login-overlay .content');
        const vp = await getViewportSize(session.page);
        expect(bounds).not.toBeNull();
        expect(bounds!.width).toBeGreaterThan(vp.width * 0.85);
      });
    }
  });
});

function getOverlayId(screen: ScreenName): string {
  const map: Record<string, string> = {
    social: 'social-overlay',
    stats: 'stats-overlay',
    music: 'music-overlay',
    auth: 'login-overlay',
    settings: 'settings-overlay',
  };
  return map[screen] ?? `${screen}-overlay`;
}
