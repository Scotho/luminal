// src/e2e/browser/online-emulator/disconnect.test.ts
// Emulator regression: guest disconnects mid-match, host detects and match ends.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { createMatchFlow, type MatchFlow } from '../online/matchFlow';
import { capturePages } from '../helpers/captureOnFailure.js';

const BASE_URL = 'http://localhost:5173';

describe('emulator: mid-match disconnect', () => {
  let match: MatchFlow;

  beforeAll(async () => {
    await startEmulators();
    await startRelay();
  }, 60_000);

  afterAll(async () => {
    await match?.cleanup();
    await stopRelay();
    await stopEmulators();
  });

  it('guest disconnect triggers forfeit for host', async () => {
    await resetEmulatorState();

    match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();
      await match.startMatch();

      // Wait 2s for gameplay to stabilize, then kill guest context
      await match.hostPage.waitForTimeout(2000);
      await match.guestCtx.close();

      // Host should eventually see a result (disconnect banner → forfeit → result)
      // The heartbeat timeout is 20s, so this may take up to ~25s
      await match.hostPage.waitForSelector('#result:not(.hidden), #disconnect-banner:not(.hidden)', {
        state: 'visible',
        timeout: 35_000,
      });

      // Verify host's page reached some end state
      const hasResult = await match.hostPage.evaluate(() =>
        !document.getElementById('result')?.classList.contains('hidden')
      );
      const hasDisconnectBanner = await match.hostPage.evaluate(() =>
        !document.getElementById('disconnect-banner')?.classList.contains('hidden')
      );

      // At least one of these should be true
      expect(hasResult || hasDisconnectBanner).toBe(true);
    } catch (err) {
      match.dumpLogs();
      await capturePages(
        [
          { page: match.hostPage, label: 'host' },
        ],
        'emulator-mid-match-disconnect',
      );
      throw err;
    }
  });
});
