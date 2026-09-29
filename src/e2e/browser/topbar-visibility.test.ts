// src/e2e/browser/topbar-visibility.test.ts
// P0 — Verify top-bar button visibility across all viewports and transition states.
//
// Why this test exists (the bug that started it):
//   The unit tests in src/ui/__tests__/topbar.test.ts passed while users were
//   reporting "none of the left-aligned top bar stuff is visible" — specifically
//   "I still do not see any of the music controls". The unit tests ran in jsdom,
//   which doesn't perform CSS layout (offsetWidth/Height always 0, computed
//   styles default, localStorage empty), so they couldn't catch layout or
//   settings-driven visibility regressions.
//
//   The actual bug was that `luminal-tb-music=false` in localStorage causes
//   settingsGameplay.ts:152 to set `#np-audio-row { display: none }`, hiding
//   the entire music controls strip. Users who had ever toggled "BAR MUSIC"
//   off in Settings → Gameplay would see the left half of the top bar empty
//   until they went back into Settings to turn it back on. No other code
//   path ever resets it.
//
// What this test covers, per viewport × state:
//   1. Visible state — every expected left-side button renders with non-zero
//      dimensions, correct computed display/visibility/opacity, and is
//      positioned within the viewport
//   2. hideTopBar() state — bar is translated off-screen but children retain
//      dimensions (so the slide-in target isn't a collapsed 0×0 layout)
//   3. showTopBar() after hide — everything returns
//   4. Round-end slide-in sequence from src/modes/roundFlow.ts
//   5. Music controls off — with `luminal-tb-music=false`, the bar itself
//      still renders and the right-side controls (including settings!) are
//      still reachable so the user can turn music back on

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Page } from 'playwright';
import {
  launchBrowser, dismissLoading,
  type BrowserSession,
} from './helpers/index.js';
import { ALL_VIEWPORTS, type Viewport } from './helpers/index.js';
import { setupFailureCapture } from './helpers/index.js';

// ── Button inventory ──────────────────────────────────────

const ALL_LEFT_MUSIC_BUTTONS = [
  'mute-btn', 'prev-btn', 'pause-btn', 'skip-btn',
  'repeat-btn', 'shuffle-btn', 'playlist-dropdown-wrap',
] as const;

const ALL_RIGHT_BUTTONS = [
  'tb-settings-btn', 'fullscreen-btn', 'notif-wrap',
] as const;

// Per-viewport expectations — must track the CSS media queries exactly.
// Look at src/styles/screens/mobile/*.css before editing these lists.
function expectedLeftButtons(vp: Viewport): readonly string[] {
  // phone-large.css @media (max-width: 768px)
  // hides: eq, track-name, vol dropdown, repeat, shuffle, playlist
  if (vp.width <= 768) {
    return ['mute-btn', 'prev-btn', 'pause-btn', 'skip-btn'];
  }
  // landscape.css @media (max-height: 500px) and (orientation: landscape)
  // hides: players-online, party-dropdown-wrap, track-name, playlist-dropdown-wrap
  if (vp.height <= 500 && vp.width > vp.height) {
    return ['mute-btn', 'prev-btn', 'pause-btn', 'skip-btn', 'repeat-btn', 'shuffle-btn'];
  }
  return ALL_LEFT_MUSIC_BUTTONS;
}

function expectedRightButtons(vp: Viewport): readonly string[] {
  if (vp.width <= 768) {
    // phone-large.css hides settings, notif, party, server-activity, players-online
    return ['fullscreen-btn'];
  }
  return ALL_RIGHT_BUTTONS;
}

// ── Visibility helpers ────────────────────────────────────

interface ButtonMetrics {
  id: string;
  found: boolean;
  width: number;
  height: number;
  left: number;
  top: number;
  display: string;
  visibility: string;
  opacity: number;
}

async function measureButtons(page: Page, ids: readonly string[]): Promise<ButtonMetrics[]> {
  return page.evaluate((idList) => {
    return idList.map((id) => {
      const el = document.getElementById(id);
      if (!el) {
        return { id, found: false, width: 0, height: 0, left: 0, top: 0,
                 display: '', visibility: '', opacity: 0 };
      }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id, found: true,
        width: r.width, height: r.height, left: r.left, top: r.top,
        display: cs.display,
        visibility: cs.visibility,
        opacity: parseFloat(cs.opacity),
      };
    });
  }, ids as string[]);
}

function isVisuallyRendered(m: ButtonMetrics): boolean {
  return m.found
    && m.width > 0 && m.height > 0
    && m.display !== 'none'
    && m.visibility !== 'hidden'
    && m.opacity > 0;
}

async function setTbMusic(page: Page, on: boolean): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('luminal-tb-music', value ? 'true' : 'false');
  }, on);
  await page.reload({ waitUntil: 'commit' });
  await dismissLoading(page);
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
  await page.addStyleTag({ content: `
    #auth-status, #auth-status * { transition: none !important; animation: none !important; }
  ` });
}

async function clearTbMusic(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem('luminal-tb-music'));
  await page.reload({ waitUntil: 'commit' });
  await dismissLoading(page);
  await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
  await page.addStyleTag({ content: `
    #auth-status, #auth-status * { transition: none !important; animation: none !important; }
  ` });
}

// ── Fixture setup ─────────────────────────────────────────

let session: BrowserSession;

const capture = setupFailureCapture(
  () => session?.page,
  () => session?.context,
);

beforeAll(async () => {
  session = await launchBrowser();
  await dismissLoading(session.page);
  // Disable CSS transitions so we measure final state immediately instead of
  // racing the 0.5s topbar slide animation. Works across reloads because we
  // re-inject in the viewport beforeAll and after setTbMusic reloads.
  await disableTopbarTransitions(session.page);
}, 30_000);

async function disableTopbarTransitions(page: Page): Promise<void> {
  await page.addStyleTag({ content: `
    #auth-status, #auth-status * { transition: none !important; animation: none !important; }
  ` });
}

afterAll(async () => {
  await session?.browser.close();
});

beforeEach(capture.before);
afterEach(capture.after);

// ── Per-viewport test suites ─────────────────────────────

describe.each(ALL_VIEWPORTS)('topbar visibility @ $label ($width x $height)', (viewport: Viewport) => {
  beforeAll(async () => {
    await session.page.setViewportSize({ width: viewport.width, height: viewport.height });
    // Start each viewport with a clean localStorage so the default (music on) is used.
    await session.page.evaluate(() => localStorage.clear());
    await session.page.reload({ waitUntil: 'commit' });
    await dismissLoading(session.page);
    await session.page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 10_000 });
    await disableTopbarTransitions(session.page);
  }, 35_000);

  // ═══════ Default state (music controls on) ═══════

  describe('default state (tb-music=on, menu screen)', () => {
    it('#auth-status is rendered with non-zero dimensions', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      expect(bar.found).toBe(true);
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.height).toBeGreaterThan(0);
      expect(bar.display).not.toBe('none');
    });

    it('#top-left is rendered with non-zero dimensions', async () => {
      const [tl] = await measureButtons(session.page, ['top-left']);
      expect(tl.found).toBe(true);
      expect(tl.width).toBeGreaterThan(0);
      expect(tl.height).toBeGreaterThan(0);
    });

    it('#auth-row is rendered with non-zero dimensions', async () => {
      const [ar] = await measureButtons(session.page, ['auth-row']);
      expect(ar.found).toBe(true);
      expect(ar.width).toBeGreaterThan(0);
      expect(ar.height).toBeGreaterThan(0);
    });

    it('every expected left-side button is visually rendered', async () => {
      const expected = expectedLeftButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible left buttons: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });

    it('every expected right-side button is visually rendered', async () => {
      const expected = expectedRightButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible right buttons: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });

    it('left-side buttons are positioned within viewport bounds', async () => {
      const expected = expectedLeftButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      for (const m of metrics) {
        expect(m.left, `${m.id} left edge`).toBeGreaterThanOrEqual(0);
        expect(m.left + m.width, `${m.id} right edge`).toBeLessThanOrEqual(viewport.width + 1);
        // -1 tolerance: buttons with 40px height centered in a 39px content
        // area (40px bar minus 1px border) can render at y=-0.5 due to flex
        // centering and sub-pixel rounding. That's still visually on-screen.
        expect(m.top, `${m.id} top edge`).toBeGreaterThanOrEqual(-1);
      }
    });

    it('right-side buttons are positioned within viewport bounds', async () => {
      const expected = expectedRightButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      for (const m of metrics) {
        expect(m.left, `${m.id} left edge`).toBeGreaterThanOrEqual(0);
        expect(m.left + m.width, `${m.id} right edge`).toBeLessThanOrEqual(viewport.width + 1);
        // -1 tolerance: buttons with 40px height centered in a 39px content
        // area (40px bar minus 1px border) can render at y=-0.5 due to flex
        // centering and sub-pixel rounding. That's still visually on-screen.
        expect(m.top, `${m.id} top edge`).toBeGreaterThanOrEqual(-1);
      }
    });

    it('left and right groups do not overlap horizontally', async () => {
      const [tl, ar] = await measureButtons(session.page, ['top-left', 'auth-row']);
      if (tl.width === 0 || ar.width === 0) return;
      expect(tl.left + tl.width, 'top-left must end before auth-row begins')
        .toBeLessThanOrEqual(ar.left);
    });
  });

  // ═══════ hideTopBar() ═══════

  describe('hideTopBar() state', () => {
    beforeAll(async () => {
      await session.page.evaluate(() => {
        (window as unknown as { _hideTopBar?: () => void })._hideTopBar?.();
      });
      await session.page.waitForTimeout(100);
    });

    afterAll(async () => {
      await session.page.evaluate(() => {
        (window as unknown as { _showTopBar?: () => void })._showTopBar?.();
      });
      await session.page.waitForTimeout(100);
    });

    it('topbar is translated off-screen (y < 0)', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      expect(bar.top).toBeLessThan(0);
    });

    it('topbar opacity is zero while hidden', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      expect(bar.opacity).toBe(0);
    });

    it('left buttons retain non-zero layout dimensions even while hidden', async () => {
      // The whole point of the class-based hide is that it only shifts the
      // bar — layout must remain intact so the slide-in has a real target.
      const expected = expectedLeftButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      for (const m of metrics) {
        expect(m.width, `${m.id} width while hidden`).toBeGreaterThan(0);
        expect(m.height, `${m.id} height while hidden`).toBeGreaterThan(0);
      }
    });
  });

  // ═══════ showTopBar() after hide (slide-in) ═══════

  describe('showTopBar() after hide (slide-in)', () => {
    beforeAll(async () => {
      await session.page.evaluate(() => {
        const w = window as unknown as { _hideTopBar?: () => void; _showTopBar?: () => void };
        w._hideTopBar?.();
      });
      await session.page.waitForTimeout(100);
      await session.page.evaluate(() => {
        (window as unknown as { _showTopBar?: () => void })._showTopBar?.();
      });
      await session.page.waitForTimeout(100);
    });

    it('topbar is back at y≈0 after slide-in', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      // ±2px tolerance — CSS transitions can land sub-pixel on some viewports
      expect(bar.top).toBeGreaterThanOrEqual(-2);
      expect(bar.top).toBeLessThanOrEqual(2);
    });

    it('topbar opacity is close to 1', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      expect(bar.opacity).toBeGreaterThan(0.95);
    });

    it('all expected left buttons are visible again after slide-in', async () => {
      const expected = expectedLeftButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible after slide-in: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });

    it('all expected right buttons are visible again after slide-in', async () => {
      const expected = expectedRightButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible after slide-in: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });
  });

  // ═══════ Round-end sequence (roundFlow.ts) ═══════

  describe('round-end slide-in sequence', () => {
    beforeAll(async () => {
      // 1. hideTopBar() at round start
      await session.page.evaluate(() => {
        (window as unknown as { _hideTopBar?: () => void })._hideTopBar?.();
      });
      await session.page.waitForTimeout(100);
      // 2. Pre-set --topbar-offset during blackout (roundFlow.ts:743)
      await session.page.evaluate(() => {
        document.documentElement.style.setProperty('--topbar-offset', '40px');
      });
      // 3. Slide in after reveal (roundFlow.ts:758)
      await session.page.evaluate(() => {
        (window as unknown as { _showTopBar?: () => void })._showTopBar?.();
      });
      await session.page.waitForTimeout(100);
    });

    it('all expected left buttons are visible after round-end slide-in', async () => {
      const expected = expectedLeftButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible post round-end: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });

    it('all expected right buttons are visible after round-end slide-in', async () => {
      const expected = expectedRightButtons(viewport);
      const metrics = await measureButtons(session.page, expected);
      const invisible = metrics.filter(m => !isVisuallyRendered(m));
      expect(invisible, `invisible post round-end: ${JSON.stringify(invisible, null, 2)}`).toEqual([]);
    });

    it('--topbar-offset CSS variable is a non-zero px value', async () => {
      const offset = await session.page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--topbar-offset').trim()
      );
      expect(offset).not.toBe('0px');
      expect(offset).toMatch(/^\d+(?:\.\d+)?px$/);
    });
  });

  // ═══════ Music-controls-off (user toggled `luminal-tb-music` off) ═══════
  //
  // This is the exact state that prompted the bug report: the user had
  // BAR MUSIC = OFF in Settings → Gameplay. We verify that:
  //   • The topbar itself is still visible (so they can reach Settings)
  //   • The right-side controls — INCLUDING the settings button — remain
  //     reachable so the user can turn music back on
  //   • The music row is correctly hidden, not just glitching

  describe('music controls off (luminal-tb-music=false)', () => {
    beforeAll(async () => {
      await setTbMusic(session.page, false);
    }, 15_000);

    afterAll(async () => {
      await clearTbMusic(session.page);
    }, 15_000);

    it('#auth-status is still rendered', async () => {
      const [bar] = await measureButtons(session.page, ['auth-status']);
      expect(bar.found).toBe(true);
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.height).toBeGreaterThan(0);
    });

    it('#np-audio-row is hidden (display:none)', async () => {
      const [audio] = await measureButtons(session.page, ['np-audio-row']);
      expect(audio.display).toBe('none');
    });

    it('right-side settings button is still reachable', async () => {
      // Only relevant when the right side is supposed to be visible.
      if (!expectedRightButtons(viewport).includes('tb-settings-btn')) return;
      const [settings] = await measureButtons(session.page, ['tb-settings-btn']);
      expect(isVisuallyRendered(settings)).toBe(true);
    });

    it('fullscreen button is still reachable', async () => {
      const [fs] = await measureButtons(session.page, ['fullscreen-btn']);
      expect(isVisuallyRendered(fs)).toBe(true);
    });
  });
});
