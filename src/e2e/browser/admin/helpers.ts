import type { Page } from 'playwright';

// ── Selectors ──────────────────────────────────────────────
export const SEL = {
  flyout: '#cc-flyout',
  statusBtn: '#cc-status-btn',
  backendToggle: '.prompt-editor-backend-toggle',
  ccBtn: '.prompt-editor-backend-toggle [data-target="cc"]',
  aiderBtn: '.prompt-editor-backend-toggle [data-target="aider"]',
  modeToggle: '.aider-mode-toggle',
  suggestBtn: '.aider-mode-toggle [data-mode="suggest"]',
  autoBtn: '.aider-mode-toggle [data-mode="auto"]',
  promptInput: '.prompt-editor-input',
  agentTabs: '#cc-agent-tabs',
  agentTab: '.cc-agent-tab',
  flyoutOutput: '#cc-flyout-output',
} as const;

const ADMIN_URL = 'http://localhost:5175';

/** Navigate to admin dashboard and wait for it to load.
 *  Uses ?e2e query param to skip Firebase auth gate. */
export async function launchAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}?e2e`, { waitUntil: 'load' });
  // Wait for Vite modules to initialize and the dashboard to mount
  await page.waitForSelector(SEL.statusBtn, { timeout: 15_000 });
  // Give the SPA time to fully initialize all components
  await page.waitForTimeout(2000);
}

/** Open the agent flyout and ensure the prompt editor is visible. */
export async function openFlyout(page: Page): Promise<void> {
  // Open the flyout panel by removing the collapsed class directly
  await page.evaluate(() => {
    const flyout = document.getElementById('cc-flyout');
    if (flyout) flyout.classList.remove('collapsed');
  });
  await page.waitForTimeout(500);

  // The prompt editor is hidden (display:none) until a session exists.
  // Force it visible for the test — this simulates clicking "Custom prompt"
  await page.evaluate(() => {
    const wrap = document.querySelector('.prompt-editor-wrap') as HTMLElement | null;
    if (wrap) wrap.style.display = '';
  });
  await page.waitForTimeout(300);

  await page.waitForSelector(SEL.promptInput, { timeout: 5_000 });
}

/** Select a backend (CC or Aider) in the prompt editor. */
export async function selectBackend(page: Page, backend: 'cc' | 'aider'): Promise<void> {
  const selector = backend === 'aider' ? SEL.aiderBtn : SEL.ccBtn;
  await page.click(selector);
  await page.waitForSelector(`${selector}.active`, { timeout: 2_000 });
}

/** Set Aider autonomy mode. Must have Aider backend selected first. */
export async function setAiderMode(page: Page, mode: 'suggest' | 'auto'): Promise<void> {
  await page.waitForSelector(`${SEL.modeToggle}.visible`, { timeout: 2_000 });
  const selector = mode === 'auto' ? SEL.autoBtn : SEL.suggestBtn;
  await page.click(selector);
  await page.waitForSelector(`${selector}.active`, { timeout: 2_000 });
}

/** Type a prompt and send it (Enter key). */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  const input = page.locator(SEL.promptInput);
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Wait for the active session to complete (done or error status). */
export async function waitForResponse(page: Page, timeout = 120_000): Promise<void> {
  await page.waitForFunction(() => {
    const output = document.querySelector('#cc-flyout-output');
    if (!output) return false;
    const textContent = output.textContent ?? '';
    return textContent.length > 20;
  }, { timeout: timeout / 2 });

  await page.waitForFunction(() => {
    const tab = document.querySelector('.cc-agent-tab.active');
    if (!tab) return true;
    return !tab.classList.contains('running');
  }, { timeout });
}

/** Get all text content from the flyout output area. */
export async function getOutputText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const output = document.querySelector('#cc-flyout-output');
    return output?.textContent?.trim() ?? '';
  });
}

/** Count the number of session tabs currently visible. */
export async function getSessionTabCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.querySelectorAll('.cc-agent-tab').length;
  });
}

/** Pre-flight check: admin dashboard and Ollama reachable. */
export async function preflight(): Promise<{ admin: boolean; ollama: boolean }> {
  const results = { admin: false, ollama: false };
  try {
    const adminRes = await fetch(`${ADMIN_URL}/__admin_exec/status`);
    results.admin = adminRes.ok;
  } catch { /* offline */ }
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags');
    results.ollama = ollamaRes.ok;
  } catch { /* offline */ }
  return results;
}
