// src/e2e/browser/online-emulator/lobby-match.test.ts
// Emulator regression: full lobby → match → result pipeline.
// Requires: Firebase Emulators + local relay + Vite dev server in test mode.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { createMatchFlow, type MatchFlow } from '../online/matchFlow';
import { capturePages } from '../helpers/captureOnFailure.js';

const BASE_URL = 'http://localhost:5173';

describe('emulator: lobby match', () => {
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

  it('host creates lobby, guest joins, match completes with result', async () => {
    await resetEmulatorState();

    match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      // Setup: host creates lobby, guest joins via invite URL
      await match.setup();
      expect(match.lobbyId).toBeTruthy();
      expect(match.lobbyId!.length).toBe(6);

      // Start the match
      await match.startMatch();

      // Drive host into wall → both see result
      await match.waitForResult();

      const result = await match.getResultText();
      // Host should show a result (FRIED = they died hitting the wall)
      expect(result.host).toBeTruthy();

      // Verify at least one outcome indicator is present
      // Game uses: FRIED (loser), VICTORY/WIN (winner), or disconnect/forfeit text
      const allText = [result.host, result.guest].join(' ').toUpperCase();
      const hasOutcome = ['FRIED', 'WIN', 'VICTORY', 'LOSE', 'DEFEAT', 'LOST', 'FORFEIT', 'DISCONNECT', 'WINNER='].some(
        keyword => allText.includes(keyword),
      );
      expect(hasOutcome).toBe(true);
    } catch (err) {
      match.dumpLogs();
      await capturePages(
        [
          { page: match.hostPage, label: 'host' },
          { page: match.guestPage, label: 'guest' },
        ],
        'emulator-lobby-match',
      );
      throw err;
    }
  });
});
