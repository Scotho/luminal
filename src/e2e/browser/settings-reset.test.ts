// src/e2e/browser/settings-reset.test.ts
// Verify the "Reset to Defaults" button restores all settings to their default values.
// Covers: audio sliders, camera sliders, graphics preset, gameplay toggles, radar toggles.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  launchBrowser, dismissLoading, navigateToScreen, returnToMenu,
  type BrowserSession,
} from './helpers/index.js';
import { setupFailureCapture } from './helpers/index.js';

/** Default slider values as declared in settings.html data-default attributes. */
const SLIDER_DEFAULTS: Record<string, string> = {
  'vol-master':    '100',
  'vol-music':     '35',
  'vol-sfx':       '50',
  'vol-voice':     '75',
  'cam-fov':       '62',
  'cam-dist':      '30',
  'cam-stiffness': '5',
  'stick-deadzone': '25',
  'radar-size':    '140',
};

/** Toggle IDs expected to be 'on' after reset. */
const TOGGLES_ON = [
  'line-assist-toggle',
  'auto-submit-toggle',
  'settings-sync-toggle',
  'tb-vis-toggle',
  'tb-music-toggle',
  'tb-online-toggle',
  'radar-toggle',
  'radar-mobile-hide-toggle',
];

let session: BrowserSession;

const capture = setupFailureCapture(
  () => session?.page,
  () => session?.context,
);

/** Open the ACCOUNT tab — that's where #btn-settings-reset lives in the
 *  desktop sidebar layout. Click elsewhere would hit a hidden tab panel. */
async function openAccountTab(): Promise<void> {
  await session.page.click('.settings-sidebar-item[data-tab="account"]');
  await session.page.waitForSelector('#settings-tab-account:not(.hidden)', { state: 'visible', timeout: 3000 });
}

beforeAll(async () => {
  session = await launchBrowser();
  await dismissLoading(session.page);
}, 30_000);

afterAll(async () => {
  await session?.browser.close();
});

beforeEach(capture.before);
afterEach(capture.after);

describe('settings reset to defaults', () => {
  it('modifying settings then resetting restores default slider values', async () => {
    await navigateToScreen(session.page, 'settings');

    // ── Mutate sliders away from defaults ──
    await session.page.evaluate(() => {
      document.querySelectorAll('#settings-overlay input[type="range"]').forEach(el => {
        const input = el as HTMLInputElement;
        const min = Number(input.min);
        const max = Number(input.max);
        // Set to min so it's definitely different from the default
        input.value = String(min);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    // Verify sliders are no longer at defaults
    const preMutate = await session.page.evaluate((defaults: Record<string, string>) => {
      const results: Record<string, boolean> = {};
      for (const [id, def] of Object.entries(defaults)) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) results[id] = el.value !== def;
      }
      return results;
    }, SLIDER_DEFAULTS);

    // At least some sliders should have changed (those whose min !== default)
    const anyChanged = Object.values(preMutate).some(v => v);
    expect(anyChanged).toBe(true);

    // ── Click reset button (first click = "ARE YOU SURE?") ──
    await openAccountTab();
    await session.page.click('#btn-settings-reset');
    // Wait for the confirm text to appear
    await session.page.waitForFunction(() => {
      const btn = document.getElementById('btn-settings-reset');
      return btn?.textContent?.includes('ARE YOU SURE');
    }, { timeout: 3000 });

    // ── Second click = confirm ──
    await session.page.click('#btn-settings-reset');
    // Brief settle for reset animations / dispatched events
    await session.page.waitForTimeout(500);

    // ── Verify all sliders restored to defaults ──
    const postReset = await session.page.evaluate((defaults: Record<string, string>) => {
      const results: Record<string, { expected: string; actual: string }> = {};
      for (const [id, def] of Object.entries(defaults)) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) results[id] = { expected: def, actual: el.value };
      }
      return results;
    }, SLIDER_DEFAULTS);

    for (const [id, { expected, actual }] of Object.entries(postReset)) {
      expect(actual, `slider #${id} should be reset to ${expected}`).toBe(expected);
    }
  }, 30_000);

  it('reset restores gameplay and radar toggles to ON', async () => {
    // Still on settings screen from previous test; navigate fresh to be safe
    await returnToMenu(session.page);
    await navigateToScreen(session.page, 'settings');

    // ── Flip toggles to OFF ──
    await session.page.evaluate((toggleIds: string[]) => {
      for (const id of toggleIds) {
        const container = document.getElementById(id);
        if (!container) continue;
        const offOption = container.querySelector('[data-val="off"]') as HTMLElement | null;
        if (offOption) offOption.click();
      }
    }, TOGGLES_ON);

    await session.page.waitForTimeout(300);

    // ── Reset (double-click pattern) ──
    await openAccountTab();
    await session.page.click('#btn-settings-reset');
    await session.page.waitForFunction(() => {
      const btn = document.getElementById('btn-settings-reset');
      return btn?.textContent?.includes('ARE YOU SURE');
    }, { timeout: 3000 });
    await session.page.click('#btn-settings-reset');
    await session.page.waitForTimeout(500);

    // ── Verify toggles are ON ──
    const toggleStates = await session.page.evaluate((toggleIds: string[]) => {
      const results: Record<string, string | null> = {};
      for (const id of toggleIds) {
        const container = document.getElementById(id);
        if (!container) { results[id] = null; continue; }
        const active = container.querySelector('.control-toggle__option--active') as HTMLElement | null;
        results[id] = active?.dataset.val ?? null;
      }
      return results;
    }, TOGGLES_ON);

    for (const [id, state] of Object.entries(toggleStates)) {
      if (state === null) continue; // toggle not found — skip
      expect(state, `toggle #${id} should be ON after reset`).toBe('on');
    }
  }, 30_000);

  it('reset sets graphics preset to high', async () => {
    await returnToMenu(session.page);
    await navigateToScreen(session.page, 'settings');

    // ── Change graphics preset away from 'high' via the control-toggle ──
    // (The old #gfx-preset <select> was replaced by #gfx-preset-toggle —
    //  a segmented span-based toggle using data-val attributes.)
    await session.page.evaluate(() => {
      const lowOpt = document.querySelector('#gfx-preset-toggle [data-val="low"]') as HTMLElement | null;
      lowOpt?.click();
    });
    await session.page.waitForTimeout(300);

    // ── Reset ──
    await openAccountTab();
    await session.page.click('#btn-settings-reset');
    await session.page.waitForFunction(() => {
      const btn = document.getElementById('btn-settings-reset');
      return btn?.textContent?.includes('ARE YOU SURE');
    }, { timeout: 3000 });
    await session.page.click('#btn-settings-reset');
    await session.page.waitForTimeout(500);

    // ── Verify preset toggle is 'high' ──
    const preset = await session.page.evaluate(() => {
      const active = document.querySelector('#gfx-preset-toggle .control-toggle__option--active') as HTMLElement | null;
      return active?.dataset.val ?? null;
    });
    expect(preset).toBe('high');
  }, 30_000);

  it('reset clears localStorage for audio and camera keys', async () => {
    await returnToMenu(session.page);
    await navigateToScreen(session.page, 'settings');

    // ── Seed localStorage with custom values ──
    await session.page.evaluate(() => {
      localStorage.setItem('luminal-vol-master', '50');
      localStorage.setItem('luminal-vol-music', '50');
      localStorage.setItem('luminal-vol-sfx', '50');
      localStorage.setItem('luminal-vol-voice', '50');
      localStorage.setItem('luminal-cam-fov', '80');
      localStorage.setItem('luminal-cam-dist', '15');
      localStorage.setItem('luminal-cam-stiffness', '10');
      localStorage.setItem('luminal-cam-shake', '0');
      localStorage.setItem('luminal-radar-size', '300');
      localStorage.setItem('luminal-radar-pos', '{"left":"50px","top":"50px"}');
    });

    // ── Reset ──
    await openAccountTab();
    await session.page.click('#btn-settings-reset');
    await session.page.waitForFunction(() => {
      const btn = document.getElementById('btn-settings-reset');
      return btn?.textContent?.includes('ARE YOU SURE');
    }, { timeout: 3000 });
    await session.page.click('#btn-settings-reset');
    await session.page.waitForTimeout(500);

    // ── Verify localStorage keys removed ──
    const remaining = await session.page.evaluate(() => {
      const keys = [
        'luminal-vol-master', 'luminal-vol-music', 'luminal-vol-sfx', 'luminal-vol-voice',
        'luminal-cam-fov', 'luminal-cam-dist', 'luminal-cam-stiffness', 'luminal-cam-shake',
        'luminal-radar-size', 'luminal-radar-pos',
      ];
      return keys.filter(k => localStorage.getItem(k) !== null);
    });
    expect(remaining, 'all luminal-* localStorage keys should be cleared after reset').toEqual([]);
  }, 30_000);

  it('confirm button reverts to original text after reset', async () => {
    await returnToMenu(session.page);
    await navigateToScreen(session.page, 'settings');
    await openAccountTab();

    // After a reset, the button text should revert from "ARE YOU SURE?" to the original
    const textBefore = await session.page.evaluate(() => {
      return document.getElementById('btn-settings-reset')?.textContent?.trim() ?? '';
    });
    expect(textBefore).toBe('RESET TO DEFAULTS');

    // First click — should show confirm
    await session.page.click('#btn-settings-reset');
    const confirmText = await session.page.evaluate(() => {
      return document.getElementById('btn-settings-reset')?.textContent?.trim() ?? '';
    });
    expect(confirmText).toBe('ARE YOU SURE?');

    // Second click — confirm and reset
    await session.page.click('#btn-settings-reset');
    await session.page.waitForTimeout(300);

    // Button should revert to original text
    const textAfter = await session.page.evaluate(() => {
      return document.getElementById('btn-settings-reset')?.textContent?.trim() ?? '';
    });
    expect(textAfter).toBe('RESET TO DEFAULTS');
  }, 15_000);
});
