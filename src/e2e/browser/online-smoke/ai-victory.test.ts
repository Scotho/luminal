// src/e2e/browser/online-smoke/ai-victory.test.ts
// Outcome test: Player drives into wall on purpose in a local AI match.
// AI should survive and win. Validates result screen shows AI victory.

import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { dismissLoadingScreen } from '../helpers/launch';
import { startTestSession, endTestSession, reportBug } from '../online/bugReporter';

const BASE_URL = process.env.SMOKE_TARGET_URL ?? 'http://localhost:5173';

describe('outcome: AI victory', () => {
  let browser: Browser;
  let page: Page;
  let hasFailure = false;

  afterAll(async () => {
    await page?.context().close().catch(() => {});
    await browser?.close().catch(() => {});
    await endTestSession(hasFailure);
  });

  it('player suicides into wall — AI wins, result screen shows defeat', async () => {
    await startTestSession('ai-victory');

    browser = await chromium.launch({ headless: false, args: ['--enable-webgl'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(60_000);
    page = await context.newPage();

    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    try {
      // ── Load and dismiss loading screen ──
      await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoadingScreen(page);

      // ── Wait for main menu ──
      await page.waitForSelector('#menu-buttons', { state: 'visible', timeout: 15_000 });

      // ── Click QUICKSTART to begin a local AI match ──
      await page.evaluate(() => {
        const btn = document.getElementById('btn-quickstart');
        if (btn) btn.click();
      });

      // ── Wait for gameplay to start ──
      // The countdown runs (3, 2, 1, GO), then gameplay begins.
      // Wait for the countdown element to appear and then disappear,
      // or wait for the game canvas to be in playing state.
      await page.waitForTimeout(2000); // let character select / pregame screens pass

      // Click through any intermediate screens (character select auto-closes on quickstart)
      // Wait for the countdown or HUD to appear
      await page.waitForFunction(() => {
        const countdown = document.getElementById('countdown');
        const hud = document.getElementById('meter-wrap');
        return (countdown && !countdown.classList.contains('hidden')) ||
               (hud && !hud.classList.contains('hidden'));
      }, { timeout: 30_000 });

      // Wait for countdown to finish — game enters playing state
      await page.waitForTimeout(5000);

      // ── Player suicides: turn hard right into wall ──
      await page.keyboard.down('d');       // turn right
      await page.waitForTimeout(2000);
      await page.keyboard.up('d');
      await page.keyboard.down('w');       // accelerate into wall
      await page.waitForTimeout(4000);
      await page.keyboard.up('w');

      // ── Wait for result screen ──
      await page.waitForFunction(() => {
        const result = document.getElementById('result');
        return result && !result.classList.contains('hidden');
      }, { timeout: 30_000 });

      // ── Validate result ──
      const resultText = await page.evaluate(() =>
        document.getElementById('result-text')?.textContent?.trim().toUpperCase() ?? ''
      );

      console.log(`\n── AI Victory Result: "${resultText}" ──\n`);

      // EXPECTED: Player lost — result should indicate defeat, not victory
      const isDefeat = resultText.includes('DEFEAT') || resultText.includes('LOSE') ||
                       resultText.includes('LOST') || resultText.includes('ELIMINATED') ||
                       resultText.includes('FRIED');
      const isVictory = resultText.includes('WIN') || resultText.includes('VICTORY');

      if (!isDefeat && !isVictory) {
        hasFailure = true;
        await reportBug({
          testName: 'ai-victory: no result text',
          error: 'Result screen appeared but no win/loss text found',
          expected: 'DEFEAT or ELIMINATED text',
          actual: `Result text: "${resultText}"`,
        });
      }

      if (isVictory) {
        hasFailure = true;
        await reportBug({
          testName: 'ai-victory: player won instead of AI',
          error: 'Player who drove into wall was declared winner',
          expected: 'AI wins — result shows DEFEAT for player',
          actual: `Result text: "${resultText}" — player won unexpectedly`,
        });
      }

      expect(isDefeat, `Expected defeat text, got: "${resultText}"`).toBe(true);
      expect(isVictory, `Should not show victory for suicidal player`).toBe(false);

      // ── Validate main menu button exists (match flow completed properly) ──
      const hasMenuBtn = await page.evaluate(() =>
        !!document.getElementById('btn-mainmenu')
      );
      expect(hasMenuBtn, 'Main menu button missing on result screen').toBe(true);

    } catch (err) {
      hasFailure = true;
      await page.screenshot({ path: 'test-results/screenshots/ai-victory.png' }).catch(() => {});
      await reportBug({
        testName: 'ai-victory: test execution failure',
        error: String(err),
        expected: 'AI match completes with defeat screen',
        actual: `Error: ${String(err)}`,
      });

      // Dump console logs
      console.error('\n── AI Victory Console Logs ──');
      consoleLogs.slice(-30).forEach(l => console.error(`  ${l}`));
      console.error('── End ──\n');

      throw err;
    }
  });
});
