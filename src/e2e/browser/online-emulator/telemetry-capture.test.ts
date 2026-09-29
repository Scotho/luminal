// src/e2e/browser/online-emulator/telemetry-capture.test.ts
// Captures match telemetry data (lockstep, packet, perf) during a live emulator match.
// Writes structured JSON to test-results/telemetry-snapshot.json for the analyst loop.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startEmulators, resetEmulatorState, stopEmulators } from '../online/emulator';
import { startRelay, stopRelay } from '../online/relay';
import { createMatchFlow, type MatchFlow } from '../online/matchFlow';
import { capturePages } from '../helpers/captureOnFailure.js';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:5173';
const GAMEPLAY_DURATION_MS = 10_000;

describe('emulator: telemetry capture', () => {
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

  it('captures telemetry during a live match', async () => {
    await resetEmulatorState();
    match = await createMatchFlow({ baseUrl: BASE_URL });

    try {
      await match.setup();
      await match.startMatch();

      // Let gameplay run for ~10 seconds with minimal input (AI drives if available)
      // Hold 'a' key on host so the bike turns but doesn't immediately die
      await match.hostPage.keyboard.down('a');
      await match.hostPage.waitForTimeout(GAMEPLAY_DURATION_MS);
      await match.hostPage.keyboard.up('a');

      // Capture telemetry from the host page
      const telemetry = await match.hostPage.evaluate(() => {
        const getStats = (window as Record<string, unknown>).__luminalGetNetcodeStats as
          (() => Record<string, unknown> | null) | undefined;
        const getPerf = (window as Record<string, unknown>).__luminalGetPerfTelemetry as
          (() => Record<string, unknown>) | undefined;

        return {
          netcodeStats: getStats ? getStats() : null,
          perfTelemetry: getPerf ? getPerf() : null,
          timestamp: new Date().toISOString(),
        };
      });

      // Write snapshot to disk for the analyst loop
      const outPath = path.resolve('test-results/telemetry-snapshot.json');
      fs.writeFileSync(outPath, JSON.stringify(telemetry, null, 2));

      // ── Baseline sanity assertions ──
      // Netcode stats should exist if we were in a match
      if (telemetry.netcodeStats) {
        const nc = telemetry.netcodeStats;
        expect(typeof nc.rtt).toBe('number');
        expect(typeof nc.health).toBe('string');
        expect(typeof nc.connected).toBe('boolean');

        // simCost should be present if lockstep was active
        if (nc.simCost) {
          const sim = nc.simCost as Record<string, number>;
          expect(sim.avg).toBeGreaterThanOrEqual(0);
          expect(sim.peak).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(sim.p95)).toBe(true);
          expect(Number.isFinite(sim.p99)).toBe(true);
        }

        // No NaN in percentile fields
        for (const key of ['jitterP95', 'jitterP99', 'inputAckP95', 'inputAckP99', 'frameTimeP95']) {
          const val = nc[key];
          if (val !== undefined) {
            expect(Number.isNaN(val)).toBe(false);
          }
        }
      }

      // Perf telemetry should always exist
      if (telemetry.perfTelemetry) {
        const perf = telemetry.perfTelemetry;
        expect((perf.totalFrames as number)).toBeGreaterThan(0);
        expect(Number.isFinite(perf.avgFrameTimeMs as number)).toBe(true);
        expect(Number.isFinite(perf.p50Ms as number)).toBe(true);
        expect(Number.isFinite(perf.p95Ms as number)).toBe(true);
        expect(Number.isFinite(perf.p99Ms as number)).toBe(true);
      }

      // At least one telemetry source should have captured data
      expect(telemetry.netcodeStats !== null || telemetry.perfTelemetry !== null).toBe(true);
    } catch (err) {
      match.dumpLogs();
      await capturePages(
        [{ page: match.hostPage, label: 'host' }],
        'emulator-telemetry-capture',
      );
      throw err;
    }
  });
});
