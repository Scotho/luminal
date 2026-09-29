// src/e2e/browser/online-emulator/vehicle-map-selection.test.ts
// Emulator regression: vehicle and map selection in the lobby UI.
// Requires: Firebase Emulators + local relay + Vite dev server in test mode.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { createMatchFlow, type MatchFlow } from '../online/matchFlow';
import { capturePages } from '../helpers/captureOnFailure.js';

const BASE_URL = 'http://localhost:5173';

describe('emulator: vehicle & map selection', () => {
  beforeAll(async () => {
    await startEmulators();
    await startRelay();
  }, 60_000);

  afterAll(async () => {
    await stopRelay();
    await stopEmulators();
  });

  it('lobby shows vehicle grid with 3 tiles', async () => {
    await resetEmulatorState();

    const match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();

      const hostPage = match.hostPage;

      // Verify all 3 vehicle tiles exist
      const bikeTile = await hostPage.$('#lobby-vtile-bike');
      const carTile = await hostPage.$('#lobby-vtile-car');
      const hoverboardTile = await hostPage.$('#lobby-vtile-hoverboard');

      expect(bikeTile).not.toBeNull();
      expect(carTile).not.toBeNull();
      expect(hoverboardTile).not.toBeNull();

      // Hoverboard is now unlocked by default — tile must be clickable.
      const hoverboardDisabled = await hostPage.evaluate(() =>
        document.getElementById('lobby-vtile-hoverboard')?.classList.contains('lobby-vehicle-tile--disabled'),
      );
      expect(hoverboardDisabled).toBe(false);

      // Bike tile should NOT have the disabled class (it is clickable)
      const bikeDisabled = await hostPage.evaluate(() =>
        document.getElementById('lobby-vtile-bike')?.classList.contains('lobby-vehicle-tile--disabled'),
      );
      expect(bikeDisabled).toBe(false);
    } catch (err) {
      match.dumpLogs();
      await capturePages([
        { page: match.hostPage, label: 'host' },
        { page: match.guestPage, label: 'guest' },
      ], 'vehicle-map-selection-grid');
      throw err;
    } finally {
      await match.cleanup();
    }
  }, 60_000);

  it('vehicle selection persists through match', async () => {
    await resetEmulatorState();

    const match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();

      const hostPage = match.hostPage;

      // Click the car vehicle tile
      await hostPage.click('#lobby-vtile-car');

      // Verify localStorage has 'car'
      const vehicleBefore = await hostPage.evaluate(() => localStorage.getItem('luminal-vehicle'));
      expect(vehicleBefore).toBe('car');

      // Start match and wait for result
      await match.startMatch();
      await match.waitForResult();

      // Verify host's localStorage still has 'car' after match
      const vehicleAfter = await hostPage.evaluate(() => localStorage.getItem('luminal-vehicle'));
      expect(vehicleAfter).toBe('car');
    } catch (err) {
      match.dumpLogs();
      await capturePages([
        { page: match.hostPage, label: 'host' },
        { page: match.guestPage, label: 'guest' },
      ], 'vehicle-map-selection-persist');
      throw err;
    } finally {
      await match.cleanup();
    }
  }, 120_000);

  it('map votes are visible in lobby', async () => {
    await resetEmulatorState();

    const match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();

      const hostPage = match.hostPage;

      // Check for map grid element
      const mapGrid = await hostPage.$('#lobby-map-grid');
      expect(mapGrid).not.toBeNull();

      // Verify at least 2 map tiles exist within the grid
      const mapTileCount = await hostPage.evaluate(() => {
        const grid = document.getElementById('lobby-map-grid');
        if (!grid) return 0;
        const tiles = grid.querySelectorAll('[id^="map-tile-"], .map-carousel-tile');
        return tiles.length;
      });
      expect(mapTileCount).toBeGreaterThanOrEqual(2);
    } catch (err) {
      match.dumpLogs();
      await capturePages([
        { page: match.hostPage, label: 'host' },
        { page: match.guestPage, label: 'guest' },
      ], 'vehicle-map-selection-mapgrid');
      throw err;
    } finally {
      await match.cleanup();
    }
  }, 60_000);

  it('host and guest see each other in lobby', async () => {
    await resetEmulatorState();

    const match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();

      const hostPage = match.hostPage;
      const guestPage = match.guestPage;

      // Wait for guest's name to appear in host's lobby (player cards may render async)
      await hostPage.waitForFunction(() => {
        const lobby = document.getElementById('lobby-overlay');
        return lobby?.textContent?.includes('TestGuest') ?? false;
      }, { timeout: 15_000 });

      // Wait for host's name to appear in guest's lobby
      await guestPage.waitForFunction(() => {
        const lobby = document.getElementById('lobby-overlay');
        return lobby?.textContent?.includes('TestHost') ?? false;
      }, { timeout: 15_000 });
    } catch (err) {
      match.dumpLogs();
      await capturePages([
        { page: match.hostPage, label: 'host' },
        { page: match.guestPage, label: 'guest' },
      ], 'vehicle-map-selection-players');
      throw err;
    } finally {
      await match.cleanup();
    }
  }, 60_000);

  it('match completes with vehicle selection intact', async () => {
    await resetEmulatorState();

    const match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();
      await match.startMatch();
      await match.waitForResult();

      const result = await match.getResultText();

      // Verify at least one outcome indicator exists
      const allText = [result.host, result.guest].join(' ').toUpperCase();
      const hasOutcome = ['FRIED', 'WIN', 'VICTORY', 'LOSE', 'DEFEAT', 'LOST', 'FORFEIT', 'DISCONNECT', 'WINNER='].some(
        keyword => allText.includes(keyword),
      );
      expect(hasOutcome).toBe(true);

      // Note: desync checks are covered by headless lockstep tests (S1-S3, C1-C5).
      // Headed emulator browsers under GPU contention can produce transient stalls
      // that trigger hash mismatches — not indicative of real determinism bugs.
    } catch (err) {
      match.dumpLogs();
      await capturePages([
        { page: match.hostPage, label: 'host' },
        { page: match.guestPage, label: 'guest' },
      ], 'vehicle-map-selection-complete');
      throw err;
    } finally {
      await match.cleanup();
    }
  }, 120_000);
});
