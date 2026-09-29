import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { LoopbackHub } from './loopbackTransport';
import { HeadlessClient } from './headlessClient';
import { createSimState, type InputFrame, type SimState, type PlayerSpawn } from '../core/simulation';
import { getSpawnPositions } from '../net/spawns';
import { BIKE_PHYSICS } from '../vehicleConfig';
import type { VehiclePhysics } from '../vehicleConfig';
import type { ScenarioConfig } from './scenarios/types';
import { MAX_SCENARIO_TICKS } from './e2eConfig';
import { startCapture, drainCapture, stopCapture } from '../netLog';
import { HeadlessPerfCollector } from './perfCollector';

const RESULTS_FILE = resolve(import.meta.dirname ?? '.', '../../test-results/.e2e-pending.json');

function defaultAiProvider(_playerIndex: number, _state: SimState, tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

export async function runScenario(config: ScenarioConfig): Promise<void> {
  const startTime = Date.now();
  const humanCount = config.humans.length;
  const aiCount = config.ais?.length ?? 0;
  const playerCount = humanCount + aiCount;
  const maxTicks = config.maxTicks ?? MAX_SCENARIO_TICKS;

  const cfgs: VehiclePhysics[] = [];
  for (const h of config.humans) cfgs.push(h.physics ?? BIKE_PHYSICS);
  for (const ai of config.ais ?? []) cfgs.push(ai.physics ?? BIKE_PHYSICS);

  const spawns: PlayerSpawn[] = config.spawns
    ? config.spawns.map((s, i) => ({ ...s, baseSpeed: s.baseSpeed ?? cfgs[i].baseSpeed }))
    : getSpawnPositions(config.seed, playerCount).map((s, i) => ({
        x: s.x,
        z: s.z,
        angle: s.angle,
        baseSpeed: cfgs[i].baseSpeed,
      }));
  const startState = createSimState(0, spawns);

  const aiProvider = aiCount > 0 ? defaultAiProvider : undefined;

  const network = config.network ?? { latencyMs: 0, packetLossRate: 0 };
  const hub = new LoopbackHub(network);
  const perfCollector = new HeadlessPerfCollector();

  const uids = Array.from({ length: humanCount }, (_, i) => `player-${i}`);
  const clients: HeadlessClient[] = [];

  try {
    startCapture();
    for (let i = 0; i < humanCount; i++) {
      const opponentUids = uids.filter((_, j) => j !== i);
      const transport = hub.createTransport(i, uids[i], opponentUids);

      clients.push(new HeadlessClient({
        myIndex: i,
        playerCount,
        humanCount,
        startState,
        cfgs,
        transport,
        inputDriver: config.humans[i].driver,
        aiInputProvider: aiProvider,
      }));
    }

    await Promise.all(clients.map(c => c.start()));

    for (let t = 0; t < maxTicks; t++) {
      perfCollector.beforeTick(t);
      for (const client of clients) client.tick();
      perfCollector.afterTick(t);

      if (config.stopWhen?.(clients, t)) break;

      const allDone = config.humans.every((h) => h.driver.isDone(t));
      if (allDone && !config.stopWhen) break;
    }

    // Build replay frames from client 0's recorded states (CompressedFrame format)
    const replayFrames: Array<{ t: number; p: number[] | null; a: Array<number[] | null> }> = [];
    const allStates = clients[0].recorder.getAllStates();
    for (const [, state] of allStates) {
      const p0 = state.players[0];
      replayFrames.push({
        t: Math.round((state.tick / 60) * 100) / 100, // tick to seconds at 60Hz
        p: p0.alive ? [
          Math.round(p0.x * 10) / 10,
          Math.round(p0.z * 10) / 10,
          Math.round(p0.angle * 1000) / 1000,
          Math.round(p0.speed),
          (p0.boosting ? 1 : 0) | (p0.dashing ? 2 : 0),
        ] : null,
        a: state.players.slice(1).map(pl => pl.alive ? [
          Math.round(pl.x * 10) / 10,
          Math.round(pl.z * 10) / 10,
          Math.round(pl.angle * 1000) / 1000,
          Math.round(pl.speed),
          (pl.boosting ? 1 : 0) | (pl.dashing ? 2 : 0),
        ] : null),
      });
    }
    replayFrames.sort((a, b) => a.t - b.t);

    // Run assertions — capture error if they fail
    let assertError: string | null = null;
    try {
      config.assert(clients);
    } catch (e: any) {
      assertError = e?.message ?? String(e);
    }

    // Export recorder data to temp file for the E2E results writer
    const scenarioResult = {
      name: config.name,
      matchType: config.matchType,
      seed: config.seed,
      maxTicks: maxTicks,
      actualTicks: clients[0]?.currentTick ?? 0,
      playerCount,
      humanCount,
      aiCount,
      network,
      status: assertError ? 'fail' : 'pass',
      error: assertError,
      durationMs: Date.now() - startTime,
      clients: clients.map(c => ({
        deaths: c.recorder.getDeaths(),
        hashes: c.recorder.getHashes(),
        finalTick: c.currentTick,
        disconnected: c.isDisconnected,
      })),
      replayFrames,
      perf: perfCollector.snapshot(startTime, { ...network, jitterMs: config.network?.jitterMs }, hub.getStats()),
    };
    // Accumulate results in a temp JSON file (works across vitest worker boundaries)
    const dir = resolve(RESULTS_FILE, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let pending: any[] = [];
    if (existsSync(RESULTS_FILE)) {
      try { pending = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')); } catch { pending = []; }
    }
    pending.push(scenarioResult);
    writeFileSync(RESULTS_FILE, JSON.stringify(pending), 'utf8');

    // Re-throw assertion error so vitest still reports the failure
    if (assertError) throw new Error(assertError);

    if (config.assertLogs) {
      config.assertLogs(drainCapture());
    }

  } finally {
    stopCapture();
    for (const c of clients) c.stop();
    hub.dispose();
  }
}
