// src/e2e/browser/online/matchFlow.ts
// Orchestrate two Playwright browsers through a lobby → match → result flow.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { VIEWPORTS, type Viewport } from '../helpers/viewports';
import { dismissLoadingScreen } from '../helpers/launch';
import { signIn, waitForAuth } from './testAccounts';
import type { RankedData, RankInfo } from '../../../ranked/types';
import { BrowserPerfCollector } from './perfCollector';
import type { PerfSnapshot } from '../../perfTypes';

export interface ConsoleEntry { type: string; text: string }

export interface MatchFlowConfig {
  /** Base URL: 'http://localhost:5173' for emulator, 'https://luminal-game.web.app' for live */
  baseUrl: string;
  viewport?: Viewport;
  seriesLength?: number;
}

export interface MatchFlow {
  browser: Browser;
  hostCtx: BrowserContext;
  guestCtx: BrowserContext;
  hostPage: Page;
  guestPage: Page;
  lobbyId: string | null;
  /** Console logs captured from both browsers (prefixed with [HOST] / [GUEST]). */
  consoleLogs: ConsoleEntry[];
  setup(): Promise<void>;
  startMatch(): Promise<void>;
  waitForResult(timeoutMs?: number, opts?: { skipDrive?: boolean }): Promise<void>;
  getResultText(): Promise<{ host: string; guest: string }>;
  /** Both players click rematch. Waits for a new countdown/game-start on both sides. */
  clickRematch(): Promise<void>;
  /** Both players return to lobby. Waits for lobby overlay visible with invite code and player list. */
  clickReturnToLobby(): Promise<void>;
  /** The specified page's player forfeits (opens pause, clicks forfeit). Waits for result screen on both. */
  clickForfeit(page: Page): Promise<void>;
  /** Wait for the disconnect banner to appear on the specified page. Default timeout 35s. */
  waitForDisconnectBanner(page: Page, timeoutMs?: number): Promise<void>;
  /** Get only [NET] prefixed console logs for netcode debugging. */
  getNetLogs(): ConsoleEntry[];
  /** Analyze netcode logs for desync, integrity, and round-transition issues. */
  getNetcodeDiagnostics(): NetcodeDiagnostics;
  /** Harvest performance metrics from both browser pages. */
  getPerfData(): Promise<PerfSnapshot>;
  /** Dump all captured console logs to stdout (call on test failure). */
  dumpLogs(): void;
  cleanup(): Promise<void>;
}

export interface NetcodeDiagnostics {
  /** Did both players agree on the same winner for each round? */
  winnersAgree: boolean;
  /** Per-round winner claims: { round: N, host: uid, guest: uid } */
  roundResults: { round: number; hostWinner: string; guestWinner: string }[];
  /** Were any desync warnings logged? */
  hasDesync: boolean;
  /** Desync detail lines */
  desyncLines: string[];
  /** Were any lockstep integrity warnings logged? */
  hasIntegrityWarning: boolean;
  /** Integrity warning lines */
  integrityLines: string[];
  /** Hash mismatch lines */
  hashMismatchLines: string[];
  /** Did both players transition through all expected phases? */
  phaseReport: { host: string[]; guest: string[] };
}

/** Headed mode uses real GPU; SwiftShader causes grey screens in Three.js scenes. */
const WEBGL_ARGS_HEADED = ['--enable-webgl'];
const WEBGL_ARGS_HEADLESS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'];

export async function createMatchFlow(config: MatchFlowConfig): Promise<MatchFlow> {
  const vp = config.viewport ?? VIEWPORTS.desktop;
  let browser: Browser;
  let guestBrowser: Browser;
  let hostCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let hostPage: Page;
  let guestPage: Page;
  let lobbyId: string | null = null;
  const consoleLogs: ConsoleEntry[] = [];
  const perfCollector = new BrowserPerfCollector();

  /** Wire console capture on a page. All messages are stored for post-test diagnostics. */
  function _captureConsole(page: Page, prefix: string): void {
    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: `[${prefix}] ${msg.text()}` });
    });
  }

  /** Force NETCODE_DEBUG=true so all [NET] logs emit even on production URLs. */
  async function _enableNetDebug(page: Page): Promise<void> {
    await page.evaluate(() => {
      (window as Record<string, unknown>).NETCODE_DEBUG = true;
    });
  }

  /** Click an element, falling back to JS click if Playwright click fails. */
  async function _clickElement(page: Page, selector: string): Promise<void> {
    try {
      await page.click(selector, { timeout: 5000 });
    } catch {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) el.click();
      }, selector);
    }
  }

  const flow: MatchFlow = {
    get browser() { return browser; },
    get hostCtx() { return hostCtx; },
    get guestCtx() { return guestCtx; },
    get hostPage() { return hostPage; },
    get guestPage() { return guestPage; },
    get lobbyId() { return lobbyId; },
    consoleLogs,

    getNetLogs() {
      return consoleLogs.filter(e => e.text.includes('[NET]'));
    },

    getNetcodeDiagnostics(): NetcodeDiagnostics {
      const netLogs = consoleLogs.filter(e => e.text.includes('[NET]'));

      // Extract round results from commitRoundEnd lines
      const roundResults: NetcodeDiagnostics['roundResults'] = [];
      const commitLines = netLogs.filter(e => e.text.includes('commitRoundEnd'));
      const hostCommits = commitLines.filter(e => e.text.includes('[HOST]'));
      const guestCommits = commitLines.filter(e => e.text.includes('[GUEST]'));
      const maxRounds = Math.max(hostCommits.length, guestCommits.length);
      for (let i = 0; i < maxRounds; i++) {
        const hWinner = hostCommits[i]?.text.match(/winner=(\S+)/)?.[1] ?? 'unknown';
        const gWinner = guestCommits[i]?.text.match(/winner=(\S+)/)?.[1] ?? 'unknown';
        roundResults.push({ round: i + 1, hostWinner: hWinner, guestWinner: gWinner });
      }

      const winnersAgree = roundResults.every(r => r.hostWinner === r.guestWinner);

      // Desync detection
      const desyncLines = netLogs
        .filter(e => e.text.includes('desync'))
        .map(e => e.text);

      // Lockstep integrity warnings
      const integrityLines = netLogs
        .filter(e => e.text.includes('lockstep integrity'))
        .map(e => e.text);

      // Hash mismatches
      const hashMismatchLines = netLogs
        .filter(e => e.text.includes('hash mismatch') || (e.text.includes('local=0x') && e.text.includes('remote=0x')))
        .map(e => e.text);

      // Phase tracking — look for key lifecycle events
      const phases = (prefix: string) => {
        const keywords = ['lobby', 'matchmaking', 'countdown', 'game-start', 'commitRoundEnd', 'result', 'disconnect'];
        return keywords.filter(kw =>
          consoleLogs.some(e => e.text.includes(`[${prefix}]`) && e.text.toLowerCase().includes(kw))
        );
      };

      return {
        winnersAgree,
        roundResults,
        hasDesync: desyncLines.length > 0,
        desyncLines,
        hasIntegrityWarning: integrityLines.length > 0,
        integrityLines,
        hashMismatchLines,
        phaseReport: { host: phases('HOST'), guest: phases('GUEST') },
      };
    },

    dumpLogs() {
      console.log('\n── Match Flow Console Logs ──');
      for (const entry of consoleLogs) {
        console.log(`  [${entry.type}] ${entry.text}`);
      }
      console.log('── End Console Logs ──\n');
    },

    async getPerfData(): Promise<PerfSnapshot> {
      return perfCollector.harvest(hostPage, guestPage, consoleLogs);
    },

    async setup() {
      // Launch TWO separate headed browsers — each needs its own GPU process.
      // Headed mode is required because headless SwiftShader can't handle the
      // full Three.js scene rebuild (GLB models, shader warmup) for online matches.
      browser = await chromium.launch({ headless: false, args: WEBGL_ARGS_HEADED });
      guestBrowser = await chromium.launch({ headless: false, args: WEBGL_ARGS_HEADED });
      hostCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      guestCtx = await guestBrowser.newContext({ viewport: { width: vp.width, height: vp.height } });
      // Set generous default timeouts — two headed browsers sharing GPU
      // against a live CDN can be very slow (guest loading screen >45s observed)
      hostCtx.setDefaultTimeout(90_000);
      guestCtx.setDefaultTimeout(90_000);
      hostPage = await hostCtx.newPage();
      guestPage = await guestCtx.newPage();

      // Wire console capture on both pages
      _captureConsole(hostPage, 'HOST');
      _captureConsole(guestPage, 'GUEST');

      // ── Host: load, sign in with real account, enable net debug, create lobby ──
      await hostPage.goto(config.baseUrl, { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoadingScreen(hostPage);
      await _enableNetDebug(hostPage);
      await signIn(hostPage, 'host');

      // Click LOBBY button to create a lobby
      await _clickElement(hostPage, '#btn-create-lobby');
      await hostPage.waitForSelector('#lobby-overlay:not(.hidden)', { state: 'visible', timeout: 10_000 });

      // Wait for the invite code to populate (element may be hidden but still has text content)
      await hostPage.waitForFunction(() => {
        const el = document.querySelector('.lobby-party-sheet-invite-code');
        return el && el.textContent && el.textContent.trim().length >= 4;
      }, { timeout: 10_000 });
      lobbyId = await hostPage.evaluate(() =>
        document.querySelector('.lobby-party-sheet-invite-code')?.textContent?.trim() ?? null
      );
      if (!lobbyId) throw new Error('Failed to extract lobby ID from host page');

      // ── Guest: load base URL first, sign in, THEN join via lobby URL ──
      // The app processes ?lobby= on init. If we load with the param before
      // sign-in completes, the anonymous user attempts the join and fails.
      await guestPage.goto(config.baseUrl, { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoadingScreen(guestPage);
      await _enableNetDebug(guestPage);
      await signIn(guestPage, 'guest');

      // Now navigate to the lobby URL — signed-in user will join properly
      const joinUrl = `${config.baseUrl}/?lobby=${lobbyId}`;
      await guestPage.goto(joinUrl, { waitUntil: 'commit', timeout: 30_000 });
      await dismissLoadingScreen(guestPage);

      // Wait for guest to appear in lobby (guest sees lobby overlay)
      await guestPage.waitForSelector('#lobby-overlay:not(.hidden)', { state: 'visible', timeout: 15_000 });

      // Wait for host's START button to become enabled (guest joined + both have vehicles)
      await hostPage.waitForFunction(() => {
        const btn = document.getElementById('btn-lobby-start');
        return btn && !btn.dataset.disabled && btn.style.opacity !== '0.3';
      }, { timeout: 15_000 });

      // Inject perf collection into both pages
      await perfCollector.inject(hostPage);
      await perfCollector.inject(guestPage);
      perfCollector.trackBandwidth(hostPage);
      perfCollector.trackBandwidth(guestPage);
    },

    async startMatch() {
      // Host clicks START
      await _clickElement(hostPage, '#btn-lobby-start');

      // Wait for gameplay to begin on both browsers — detect via console logs
      // The loading screen / countdown will show, then the game loop starts
      const deadline = Date.now() + 90_000;
      const hasGameplay = (prefix: string) =>
        consoleLogs.some(e => e.text.includes(`[${prefix}]`) && (
          e.text.includes('game-start') || e.text.includes('countdown-go') ||
          e.text.includes('[NET]') // Any NET log means transport is active
        ));

      while (Date.now() < deadline) {
        if (hasGameplay('HOST') && hasGameplay('GUEST')) break;
        await hostPage.waitForTimeout(1000);
      }

      // Brief settle for game loop to initialize
      await hostPage.waitForTimeout(2000);
    },

    async waitForResult(timeoutMs = 60_000, { skipDrive = false } = {}) {
      if (!skipDrive) {
        // Drive host into wall by holding right turn key.
        // Keep the key held during the entire wait — under GPU contention the
        // game loop may stall, so a short 3s hold may not advance enough ticks.
        await hostPage.keyboard.down('d');
      }

      // Wait for round to complete. Accept any of:
      // 1. commitRoundEnd in NET logs from both browsers
      // 2. Result screen visible on host (DOM #result-text)
      // 3. Disconnect banner on guest (opponent died → disconnect detection)
      const deadline = Date.now() + timeoutMs;
      try {
        while (Date.now() < deadline) {
          const hasHostRoundEnd = consoleLogs.some(e =>
            e.text.includes('[HOST]') && e.text.includes('commitRoundEnd'));
          const hasGuestRoundEnd = consoleLogs.some(e =>
            e.text.includes('[GUEST]') && e.text.includes('commitRoundEnd'));
          if (hasHostRoundEnd && hasGuestRoundEnd) return;

          // Fallback: check if host result screen is visible
          const hostResult = await hostPage.evaluate(() => {
            const el = document.getElementById('result-text');
            return el && el.textContent && el.textContent.trim().length > 0;
          }).catch(() => false);
          if (hostResult) return;

          await hostPage.waitForTimeout(1000);
        }
        throw new Error('Round did not complete within timeout — no commitRoundEnd or result screen');
      } finally {
        if (!skipDrive) {
          await hostPage.keyboard.up('d').catch(() => {});
        }
      }
    },

    async getResultText() {
      // Try DOM first (if result screen rendered)
      const getText = (page: Page) => page.evaluate(() =>
        document.getElementById('result-text')?.textContent?.trim() ?? ''
      ).catch(() => '');

      const host = await getText(hostPage);
      const guest = await getText(guestPage);

      // Fall back to extracting winner from NET logs
      if (!host && !guest) {
        const roundEndLog = consoleLogs.find(e => e.text.includes('commitRoundEnd'));
        const winner = roundEndLog?.text.match(/winner=(\w+)/)?.[1] ?? 'unknown';
        return { host: `winner=${winner}`, guest: `winner=${winner}` };
      }
      return { host, guest };
    },

    async clickRematch() {
      // Both players click the rematch button. The first clicker enters a
      // "WAITING FOR OPPONENT..." state; the second triggers the rematch flow.
      // We click host first, then guest, with a small stagger to mimic reality.
      await _clickElement(hostPage, '#btn-online-rematch');
      await hostPage.waitForTimeout(500);
      await _clickElement(guestPage, '#btn-online-rematch');

      // Wait for a new countdown or game-start on both sides.
      // The rematch resets state and starts a new pregame/countdown sequence.
      const deadline = Date.now() + 60_000;
      const hasNewRound = (prefix: string) =>
        consoleLogs.some(e =>
          e.text.includes(`[${prefix}]`) && (
            e.text.includes('countdown') || e.text.includes('game-start') ||
            e.text.includes('bothLoaded')
          ) &&
          // Only count logs after the rematch click (use a rough timestamp filter
          // by checking that the log appeared after the rematch buttons were clicked)
          consoleLogs.indexOf(e) > consoleLogs.length - 200
        );

      while (Date.now() < deadline) {
        if (hasNewRound('HOST') && hasNewRound('GUEST')) return;
        await hostPage.waitForTimeout(1000);
      }

      // Fallback: check if countdown element or pregame screen is visible on host
      const countdownVisible = await hostPage.evaluate(() => {
        const cd = document.getElementById('countdown');
        return cd && !cd.classList.contains('hidden');
      }).catch(() => false);
      if (countdownVisible) return;

      throw new Error('Rematch did not start within 60s — no countdown or game-start detected');
    },

    async clickReturnToLobby() {
      // Only the lobby host has the "Return Party to Lobby" button visible.
      // When host clicks it, both players are signalled to return to lobby.
      await _clickElement(hostPage, '#btn-return-lobby-result');

      // Wait for lobby overlay to be visible on both pages
      await Promise.all([
        hostPage.waitForSelector('#lobby-overlay:not(.hidden)', { state: 'visible', timeout: 15_000 }),
        guestPage.waitForSelector('#lobby-overlay:not(.hidden)', { state: 'visible', timeout: 15_000 }),
      ]);

      // Verify lobby state: invite code present on host
      await hostPage.waitForFunction(() => {
        const el = document.querySelector('.lobby-party-sheet-invite-code');
        return el && el.textContent && el.textContent.trim().length >= 4;
      }, { timeout: 10_000 });

      // Verify both players are listed in the lobby.
      // The lobby player list should contain at least 2 entries.
      await hostPage.waitForFunction(() => {
        const players = document.querySelectorAll('.lobby-player-card, .lobby-party-sheet-player');
        return players.length >= 2;
      }, { timeout: 10_000 });
    },

    async clickForfeit(page: Page) {
      // Open the online pause overlay by pressing Escape
      await page.keyboard.press('Escape');

      // Wait for the pause overlay to become visible
      await page.waitForSelector('#online-pause-overlay:not(.hidden)', { state: 'visible', timeout: 5_000 });

      // Click the forfeit button
      await _clickElement(page, '#btn-online-forfeit');

      // Wait for the result screen to appear on both pages.
      // Forfeit reports the player as dead, so the opponent wins immediately.
      const waitForResultScreen = async (p: Page): Promise<void> => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const hasResult = await p.evaluate(() => {
            const el = document.getElementById('result-text');
            return el && el.textContent && el.textContent.trim().length > 0;
          }).catch(() => false);
          if (hasResult) return;

          // Also accept commitRoundEnd in logs as evidence that the round concluded
          const prefix = p === hostPage ? 'HOST' : 'GUEST';
          const hasRoundEnd = consoleLogs.some(e =>
            e.text.includes(`[${prefix}]`) && e.text.includes('commitRoundEnd'));
          if (hasRoundEnd) return;

          await p.waitForTimeout(500);
        }
        throw new Error('Result screen did not appear within 30s after forfeit');
      };

      await Promise.all([
        waitForResultScreen(hostPage),
        waitForResultScreen(guestPage),
      ]);
    },

    async waitForDisconnectBanner(page: Page, timeoutMs = 35_000) {
      // The disconnect banner appears when the opponent's heartbeat is missed.
      // It transitions through: hidden → warning → critical → forfeit.
      // We wait for the banner to be visible (any non-hidden state).
      await page.waitForFunction(() => {
        const banner = document.getElementById('disconnect-banner');
        return banner && !banner.classList.contains('hidden');
      }, { timeout: timeoutMs });
    },

    async cleanup() {
      perfCollector.cleanup();
      await hostCtx?.close().catch(() => {});
      await guestCtx?.close().catch(() => {});
      await browser?.close().catch(() => {});
      await guestBrowser?.close().catch(() => {});
    },
  };

  return flow;
}

// ── Ranked Match Flow ─────────────────────────────────────

export interface RankedMatchFlowConfig extends MatchFlowConfig {
  hostRankedData?: { mmr: number; rank: RankInfo };
  guestRankedData?: { mmr: number; rank: RankInfo };
}

export interface RankedMatchFlow extends MatchFlow {
  /** Fetch the ranked data for a user from the Firestore emulator. */
  getRankedResult(uid: string): Promise<RankedData | null>;
}

const EMULATOR_FIRESTORE_PORT = 8080;
const EMULATOR_PROJECT_ID = 'luminal-game';

/**
 * Create a ranked-aware match flow that wraps the base `createMatchFlow`.
 * Adds `getRankedResult()` to fetch post-match ranked data from Firestore.
 */
export async function createRankedMatchFlow(
  config: RankedMatchFlowConfig,
): Promise<RankedMatchFlow> {
  const base = await createMatchFlow(config);

  const rankedFlow: RankedMatchFlow = {
    ...base,

    async getRankedResult(uid: string): Promise<RankedData | null> {
      const fsBase = `http://localhost:${EMULATOR_FIRESTORE_PORT}/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`;
      const res = await fetch(`${fsBase}/users/${uid}`, {
        headers: { Authorization: 'Bearer owner' },
      });

      if (!res.ok) return null;

      const doc = (await res.json()) as {
        fields?: {
          ranked?: {
            mapValue?: {
              fields?: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean; mapValue?: { fields?: Record<string, { stringValue?: string; integerValue?: string }> } }>;
            };
          };
        };
      };

      const rankedFields = doc.fields?.ranked?.mapValue?.fields;
      if (!rankedFields) return null;

      const rankFields = rankedFields.rank?.mapValue?.fields;
      if (!rankFields) return null;

      return {
        mmr: Number(rankedFields.mmr?.integerValue ?? 0),
        rank: {
          tier: (rankFields.tier?.stringValue ?? 'bronze') as RankedData['rank']['tier'],
          division: Number(rankFields.division?.integerValue ?? 4) as RankedData['rank']['division'],
          lp: Number(rankFields.lp?.integerValue ?? 0),
        },
        placementGamesPlayed: Number(rankedFields.placementGamesPlayed?.integerValue ?? 0),
        placementComplete: rankedFields.placementComplete?.booleanValue ?? false,
        rankedWins: Number(rankedFields.rankedWins?.integerValue ?? 0),
        rankedLosses: Number(rankedFields.rankedLosses?.integerValue ?? 0),
        rankedGamesPlayed: Number(rankedFields.rankedGamesPlayed?.integerValue ?? 0),
        lastRankedMatch: Number(rankedFields.lastRankedMatch?.integerValue ?? 0),
        demotionShield: rankedFields.demotionShield?.booleanValue ?? false,
        seasonId: Number(rankedFields.seasonId?.integerValue ?? 1),
      };
    },
  };

  return rankedFlow;
}
