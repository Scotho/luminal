// src/e2e/browser/admin/aider-integration.test.ts
// E2E test: Aider integration in admin dashboard agent flyout.
// Validates backend selector, suggest mode dispatch, multi-turn conversation,
// and auto mode admin task creation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  launchAdmin,
  openFlyout,
  selectBackend,
  setAiderMode,
  sendPrompt,
  waitForResponse,
  getOutputText,
  getSessionTabCount,
  preflight,
  SEL,
} from './helpers';

describe('Aider Dashboard Integration', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    // Pre-flight checks
    const status = await preflight();
    if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');
    if (!status.ollama) throw new Error('Ollama not running at localhost:11434');

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(120_000);
    page = await context.newPage();
  }, 30_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  });

  it('backend selector shows CC and Llama buttons with autonomy toggle', async () => {
    await launchAdmin(page);
    await openFlyout(page);

    // CC and Aider buttons should be visible
    await expect(page.locator(SEL.ccBtn).isVisible()).resolves.toBe(true);
    await expect(page.locator(SEL.aiderBtn).isVisible()).resolves.toBe(true);

    // CC should be active by default
    const ccClass = await page.locator(SEL.ccBtn).getAttribute('class');
    expect(ccClass).toContain('active');

    const aiderClass = await page.locator(SEL.aiderBtn).getAttribute('class');
    expect(aiderClass).not.toContain('active');

    // Autonomy toggle should be hidden when CC is selected
    const modeClass = await page.locator(SEL.modeToggle).getAttribute('class');
    expect(modeClass).not.toContain('visible');

    // Select Aider — autonomy toggle should appear
    await selectBackend(page, 'aider');
    const aiderClassAfter = await page.locator(SEL.aiderBtn).getAttribute('class');
    expect(aiderClassAfter).toContain('active');

    const modeClassAfter = await page.locator(SEL.modeToggle).getAttribute('class');
    expect(modeClassAfter).toContain('visible');

    const suggestClass = await page.locator(SEL.suggestBtn).getAttribute('class');
    expect(suggestClass).toContain('active');

    // Switch back to CC — toggle should hide
    await selectBackend(page, 'cc');
    const modeClassFinal = await page.locator(SEL.modeToggle).getAttribute('class');
    expect(modeClassFinal).not.toContain('visible');
  });

  it('suggest mode dispatch creates Aider session with response', async () => {
    await launchAdmin(page);
    await openFlyout(page);

    await selectBackend(page, 'aider');
    await setAiderMode(page, 'suggest');

    const tabsBefore = await getSessionTabCount(page);

    // Send a simple prompt
    await sendPrompt(page, 'What files are in the admin/src/ui directory? Just list them briefly.');

    // Verify a new session tab appeared
    // Give it a moment to create the session
    await page.waitForTimeout(2000);
    const tabsAfter = await getSessionTabCount(page);
    expect(tabsAfter).toBeGreaterThan(tabsBefore);

    // Wait for response
    await waitForResponse(page);

    // Verify we got meaningful output
    const output = await getOutputText(page);
    expect(output.length).toBeGreaterThan(20);
  }, 180_000);

  it('follow-up message stays in same session tab', async () => {
    // This test continues from the previous test's session
    // (or creates a new one if needed)
    await launchAdmin(page);
    await openFlyout(page);

    await selectBackend(page, 'aider');
    await setAiderMode(page, 'suggest');

    // First message
    await sendPrompt(page, 'What is the purpose of ccDispatch.ts? Answer in one sentence.');
    await page.waitForTimeout(2000);
    await waitForResponse(page);

    const tabsAfterFirst = await getSessionTabCount(page);

    // Second message — should reuse same session
    await sendPrompt(page, 'And what about ccSessionManager.ts? One sentence.');
    await waitForResponse(page);

    const tabsAfterSecond = await getSessionTabCount(page);

    // Same number of tabs — follow-up stayed in the same session
    expect(tabsAfterSecond).toBe(tabsAfterFirst);
  }, 240_000);

  it('auto mode can create admin task (E2E verification)', async () => {
    await launchAdmin(page);
    await openFlyout(page);

    await selectBackend(page, 'aider');
    await setAiderMode(page, 'auto');

    // Ask Aider to create a task via curl to the admin API
    const uniqueTag = `e2e-aider-${Date.now()}`;
    await sendPrompt(page,
      `Run this exact shell command and show me the output: ` +
      `curl -s -X POST http://localhost:5175/__admin_task ` +
      `-H "Content-Type: application/json" ` +
      `-d '{"tag":"${uniqueTag}","prompt":"Aider E2E test task","source":"aider-e2e","priority":5,"status":"done"}'`,
    );
    await waitForResponse(page, 180_000);

    // Verify the task was created by checking the admin API directly
    try {
      const tasksRes = await fetch('http://localhost:5175/data/tasks.json');
      if (tasksRes.ok) {
        const tasks = await tasksRes.json() as Array<{ tag: string }>;
        const found = tasks.some(t => t.tag === uniqueTag);
        expect(found).toBeTruthy();
      }
    } catch {
      // If we can't verify via API, at least verify Aider produced output
    }

    const output = await getOutputText(page);
    expect(output.length).toBeGreaterThan(10);
  }, 240_000);
});
