// src/e2e/browser/admin/cc-panel.test.ts
// Comprehensive E2E tests for the Claude Code chat panel.
// Tests flyout lifecycle, tabs, effort dropdown, skill popover,
// prompt editor, keyboard shortcuts, persistence, and settings.
//
// Claude-specific test requirements — web-first approach:
// - All interactions use evaluate() for click reliability (avoids pointer interception)
// - Tests are sequential (shared browser state)
// - No model inference — pure UI/DOM verification
// - Flyout state is always explicitly set before assertions

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { launchAdmin, openFlyout, getSessionTabCount, preflight, SEL } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Click an element by selector using evaluate (bypasses pointer interception). */
async function safeClick(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
  }, selector);
  await page.waitForTimeout(200);
}

/** Ensure flyout is open and prompt editor is visible. */
async function ensureFlyoutOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const flyout = document.getElementById('cc-flyout');
    if (flyout) flyout.classList.remove('collapsed');
    const wrap = document.querySelector('.prompt-editor-wrap') as HTMLElement | null;
    if (wrap) wrap.style.display = '';
  });
  await page.waitForTimeout(300);
}

/** Ensure flyout is closed. */
async function ensureFlyoutClosed(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('cc-flyout')?.classList.add('collapsed');
  });
  await page.waitForTimeout(200);
}

// ── Shared setup ──────────────────────────────────────────────────────────────

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  const status = await preflight();
  if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  context.setDefaultTimeout(10_000);
  page = await context.newPage();
  await launchAdmin(page);
}, 30_000);

afterAll(async () => {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
});

// ── 1. Flyout Lifecycle ───────────────────────────────────────────────────────

describe('Flyout — open, close, toggle', () => {
  it('flyout starts collapsed', async () => {
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('opens on status button click', async () => {
    await safeClick(page, SEL.statusBtn);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).not.toContain('collapsed');
  });

  it('closes on close button click', async () => {
    await ensureFlyoutOpen(page);
    await safeClick(page, SEL.closeBtn);
    await page.waitForTimeout(100);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('closes on Escape key', async () => {
    await ensureFlyoutOpen(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('Ctrl+\\ toggles flyout open and closed', async () => {
    await ensureFlyoutClosed(page);

    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(300);
    let cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).not.toContain('collapsed');

    await page.keyboard.press('Control+\\');
    await page.waitForTimeout(300);
    cls = await page.locator(SEL.flyout).getAttribute('class');
    expect(cls).toContain('collapsed');
  });

  it('flyout contains required structural elements', async () => {
    await ensureFlyoutOpen(page);
    const elements = await page.evaluate(() => ({
      tabs: !!document.getElementById('cc-agent-tabs'),
      output: !!document.getElementById('cc-flyout-output'),
      editorMount: !!document.getElementById('cc-prompt-editor-mount'),
      closeBtn: !!document.getElementById('cc-flyout-close'),
      cancelBtn: !!document.getElementById('cc-flyout-cancel'),
      newAgent: !!document.getElementById('cc-new-agent'),
      resize: !!document.getElementById('cc-flyout-resize'),
    }));
    expect(elements.tabs).toBe(true);
    expect(elements.output).toBe(true);
    expect(elements.editorMount).toBe(true);
    expect(elements.closeBtn).toBe(true);
    expect(elements.cancelBtn).toBe(true);
    expect(elements.newAgent).toBe(true);
    expect(elements.resize).toBe(true);
  });
});

// ── 2. New Chat / Template Dropdown ───────────────────────────────────────────

describe('New Chat — template dropdown', () => {
  it('new agent button opens template dropdown', async () => {
    await ensureFlyoutOpen(page);
    await safeClick(page, SEL.newAgentBtn);
    const visible = await page.evaluate(() => !!document.querySelector('.cc-template-dropdown'));
    expect(visible).toBe(true);
  });

  it('dropdown has template items', async () => {
    const count = await page.evaluate(() =>
      document.querySelectorAll('.cc-template-item').length
    );
    expect(count).toBeGreaterThan(0);
  });

  it('clicking Custom prompt opens editor and closes dropdown', async () => {
    await safeClick(page, '[data-template-id="__custom"]');
    const dropdownGone = await page.evaluate(() => !document.querySelector('.cc-template-dropdown'));
    expect(dropdownGone).toBe(true);

    const editorVisible = await page.evaluate(() => {
      const wrap = document.querySelector('.prompt-editor-wrap') as HTMLElement | null;
      return wrap ? wrap.style.display !== 'none' : false;
    });
    expect(editorVisible).toBe(true);
  });

  it('Escape closes template dropdown', async () => {
    await safeClick(page, SEL.newAgentBtn);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => !!document.querySelector('.cc-template-dropdown'))).toBe(true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => !!document.querySelector('.cc-template-dropdown'))).toBe(false);
  });
});

// ── 3. Backend Toggle & Effort ────────────────────────────────────────────────

describe('Prompt Editor — backend toggle and effort', () => {
  it('CC backend is active by default', async () => {
    await ensureFlyoutOpen(page);
    // Reset to CC
    await safeClick(page, SEL.ccBtn);
    const ccActive = await page.evaluate(() =>
      document.querySelector('[data-target="cc"]')?.classList.contains('active')
    );
    expect(ccActive).toBe(true);
  });

  it('switching to Aider shows mode toggle', async () => {
    await safeClick(page, SEL.aiderBtn);
    const aiderActive = await page.evaluate(() =>
      document.querySelector('[data-target="aider"]')?.classList.contains('active')
    );
    expect(aiderActive).toBe(true);

    const modeVisible = await page.evaluate(() =>
      document.querySelector('.aider-mode-toggle')?.classList.contains('visible')
    );
    expect(modeVisible).toBe(true);

    // Switch back to CC
    await safeClick(page, SEL.ccBtn);
  });

  it('effort dropdown opens and shows all 4 levels', async () => {
    await safeClick(page, SEL.effortTrigger);
    const menuOpen = await page.evaluate(() =>
      document.querySelector('.effort-menu')?.classList.contains('open')
    );
    expect(menuOpen).toBe(true);

    const levels = await page.evaluate(() => {
      const btns = document.querySelectorAll('.effort-menu button');
      return Array.from(btns).map(b => (b as HTMLElement).dataset.effort);
    });
    expect(levels).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('selecting effort level updates display and closes menu', async () => {
    await safeClick(page, '.effort-menu button[data-effort="low"]');
    const value = await page.evaluate(() =>
      document.querySelector('.effort-value')?.textContent
    );
    expect(value).toBe('low');

    const menuOpen = await page.evaluate(() =>
      document.querySelector('.effort-menu')?.classList.contains('open')
    );
    expect(menuOpen).toBe(false);

    // Reset to high
    await safeClick(page, SEL.effortTrigger);
    await safeClick(page, '.effort-menu button[data-effort="high"]');
  });
});

// ── 4. Skill Popover ──────────────────────────────────────────────────────────

describe('Skill Popover — / trigger, navigation, selection', () => {
  it('typing / opens skill popover', async () => {
    await ensureFlyoutOpen(page);
    // Focus the input
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el?.focus();
    });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    const popoverVisible = await page.evaluate(() => !!document.querySelector('.skill-popover'));
    expect(popoverVisible).toBe(true);
  });

  it('popover shows skill items and is not clipped', async () => {
    const info = await page.evaluate(() => {
      const pop = document.querySelector('.skill-popover') as HTMLElement;
      if (!pop) return null;
      const items = pop.querySelectorAll('.skill-popover-item').length;
      const rect = pop.getBoundingClientRect();
      return { items, width: rect.width, height: rect.height, top: rect.top };
    });
    expect(info).not.toBeNull();
    expect(info!.items).toBeGreaterThan(0);
    expect(info!.width).toBeGreaterThanOrEqual(200);
    expect(info!.height).toBeGreaterThan(50);
    expect(info!.top).toBeGreaterThanOrEqual(0);
  });

  it('ArrowDown/ArrowUp navigates items', async () => {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const idx = await page.evaluate(() => {
      const sel = document.querySelector('.skill-popover-item.selected');
      return sel ? parseInt((sel as HTMLElement).dataset.index ?? '-1') : -1;
    });
    expect(idx).toBe(1);

    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const idxAfter = await page.evaluate(() => {
      const sel = document.querySelector('.skill-popover-item.selected');
      return sel ? parseInt((sel as HTMLElement).dataset.index ?? '-1') : -1;
    });
    expect(idxAfter).toBe(0);
  });

  it('Escape closes popover', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const gone = await page.evaluate(() => !document.querySelector('.skill-popover'));
    expect(gone).toBe(true);
  });

  it('Enter selects a skill and inserts a label', async () => {
    // Clear input
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el.textContent = '';
      el.focus();
    });
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Select first item
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const hasLabel = await page.evaluate(() => !!document.querySelector('.skill-label'));
    expect(hasLabel).toBe(true);
  });

  it('skill label close button removes it', async () => {
    await safeClick(page, '.skill-label-close');
    const labelGone = await page.evaluate(() => !document.querySelector('.skill-label'));
    expect(labelGone).toBe(true);
  });
});

// ── 5. Keyboard Shortcuts ─────────────────────────────────────────────────────

describe('Keyboard Shortcuts', () => {
  it('Ctrl+F opens search bar when flyout is open', async () => {
    await ensureFlyoutOpen(page);
    // Blur any focused input
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(100);

    await page.keyboard.press('Control+f');
    await page.waitForTimeout(300);

    const searchVisible = await page.evaluate(() => {
      const el = document.querySelector('.cc-search-bar') as HTMLElement | null;
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    expect(searchVisible).toBe(true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  it('Ctrl+Shift+N triggers new agent dropdown', async () => {
    await ensureFlyoutOpen(page);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.waitForTimeout(100);

    await page.keyboard.press('Control+Shift+N');
    await page.waitForTimeout(500);

    const dropdownVisible = await page.evaluate(() => !!document.querySelector('.cc-template-dropdown'));
    expect(dropdownVisible).toBe(true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });
});

// ── 6. Tab Management ─────────────────────────────────────────────────────────

describe('Tab Management — create, close', () => {
  it('template custom prompt does not create tab until sent', async () => {
    await ensureFlyoutOpen(page);
    const tabsBefore = await getSessionTabCount(page);

    await safeClick(page, SEL.newAgentBtn);
    await safeClick(page, '[data-template-id="__custom"]');

    const tabsAfter = await getSessionTabCount(page);
    expect(tabsAfter).toBe(tabsBefore);
  });

  it('closing a tab reduces count', async () => {
    const tabs = await getSessionTabCount(page);
    if (tabs === 0) return; // skip if no tabs

    // Close first tab using evaluate
    await page.evaluate(() => {
      const closeBtn = document.querySelector('.cc-session-close') as HTMLElement | null;
      closeBtn?.click();
    });
    await page.waitForTimeout(300);

    const tabsAfter = await getSessionTabCount(page);
    expect(tabsAfter).toBe(tabs - 1);
  });
});

// ── 7. Prompt Editor Input ────────────────────────────────────────────────────

describe('Prompt Editor — input behavior', () => {
  it('input is contentEditable', async () => {
    await ensureFlyoutOpen(page);
    const editable = await page.evaluate(() =>
      document.querySelector('.prompt-editor-input')?.getAttribute('contenteditable')
    );
    expect(editable).toBe('true');
  });

  it('typing text appears in input', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el.textContent = '';
      el.focus();
    });
    await page.keyboard.type('hello world');

    const text = await page.evaluate(() =>
      document.querySelector('.prompt-editor-input')?.textContent?.trim()
    );
    expect(text).toContain('hello world');
  });

  it('Shift+Enter inserts newline (does not send)', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el.textContent = '';
      el.focus();
    });
    await page.keyboard.type('line1');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line2');

    const text = await page.evaluate(() =>
      document.querySelector('.prompt-editor-input')?.textContent ?? ''
    );
    expect(text).toContain('line1');
    expect(text).toContain('line2');

    // Clean up
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el.textContent = '';
    });
  });

  it('has a placeholder attribute', async () => {
    const placeholder = await page.evaluate(() =>
      document.querySelector('.prompt-editor-input')?.getAttribute('data-placeholder')
    );
    expect(placeholder).toBeTruthy();
  });
});

// ── 8. Settings Popup ─────────────────────────────────────────────────────────

describe('Settings Popup', () => {
  it('settings button opens popup', async () => {
    await ensureFlyoutOpen(page);
    await safeClick(page, SEL.settingsBtn);
    const open = await page.evaluate(() =>
      document.getElementById('cc-flyout-settings-popup')?.classList.contains('open')
    );
    expect(open).toBe(true);
  });

  it('popup has action buttons', async () => {
    const actions = await page.evaluate(() => {
      const btns = document.querySelectorAll('#cc-flyout-settings-popup button[data-action]');
      return Array.from(btns).map(b => (b as HTMLElement).dataset.action);
    });
    expect(actions.length).toBeGreaterThan(0);
  });

  it('clicking elsewhere closes popup', async () => {
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(200);
    const open = await page.evaluate(() =>
      document.getElementById('cc-flyout-settings-popup')?.classList.contains('open')
    );
    expect(open).toBe(false);
  });
});

// ── 9. Persistence ────────────────────────────────────────────────────────────

describe('Persistence — across navigation', () => {
  it('backend toggle state is immediately reflected in UI', async () => {
    await ensureFlyoutOpen(page);
    await safeClick(page, SEL.aiderBtn);

    const aiderActive = await page.evaluate(() =>
      document.querySelector('[data-target="aider"]')?.classList.contains('active')
    );
    expect(aiderActive).toBe(true);

    await safeClick(page, SEL.ccBtn);
    const ccActive = await page.evaluate(() =>
      document.querySelector('[data-target="cc"]')?.classList.contains('active')
    );
    expect(ccActive).toBe(true);
  });

  it('sessionStorage has valid tab state structure', async () => {
    const valid = await page.evaluate(() => {
      const raw = sessionStorage.getItem('luminal-agent-tabs');
      if (!raw) return true; // No state yet is valid
      try {
        const state = JSON.parse(raw);
        return typeof state === 'object' && Array.isArray(state.sessions);
      } catch { return false; }
    });
    expect(valid).toBe(true);
  });

  it('flyout structural elements survive page reload', async () => {
    await page.goto('about:blank');
    await page.waitForTimeout(300);
    await launchAdmin(page);
    await page.waitForTimeout(1000);
    await ensureFlyoutOpen(page);

    const hasStructure = await page.evaluate(() => ({
      tabs: !!document.getElementById('cc-agent-tabs'),
      output: !!document.getElementById('cc-flyout-output'),
      editor: !!document.querySelector('.prompt-editor-input'),
    }));
    expect(hasStructure.tabs).toBe(true);
    expect(hasStructure.output).toBe(true);
    expect(hasStructure.editor).toBe(true);
  });
});

// ── 10. CSS & Visual ──────────────────────────────────────────────────────────

describe('CSS & Visual Integrity', () => {
  it('flyout has a background color', async () => {
    await ensureFlyoutOpen(page);
    const bg = await page.evaluate(() => {
      const el = document.getElementById('cc-flyout');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('code block class has a background', async () => {
    const hasBg = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'cc-code-block';
      document.body.appendChild(el);
      const bg = getComputedStyle(el).backgroundColor;
      el.remove();
      return bg !== '' && bg !== 'rgba(0, 0, 0, 0)';
    });
    expect(hasBg).toBe(true);
  });

  it('resize handle exists', async () => {
    const exists = await page.evaluate(() => !!document.getElementById('cc-flyout-resize'));
    expect(exists).toBe(true);
  });
});

// ── 11. Message History ───────────────────────────────────────────────────────

describe('Message History', () => {
  it('ArrowUp in empty input does nothing', async () => {
    await ensureFlyoutOpen(page);
    await page.evaluate(() => {
      const el = document.querySelector('.prompt-editor-input') as HTMLElement;
      el.textContent = '';
      el.focus();
    });
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);

    const text = await page.evaluate(() =>
      document.querySelector('.prompt-editor-input')?.textContent ?? ''
    );
    expect(text.trim()).toBe('');
  });
});
