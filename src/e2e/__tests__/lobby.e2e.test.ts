import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  L1_2h1ai,
  L2_2h2ai,
  L3_1h3ai,
  L5_4h0ai,
  L6_lobbyDisconnect,
  L9_mixedDeathOrder,
} from '../scenarios/lobby';

describe('Lobby Match E2E (T1 — Loopback)', () => {
  it('L1: 2H + 1AI basic mixed lobby', () => runScenario(L1_2h1ai));
  it('L2: 2H + 2AI common 4-player party', () => runScenario(L2_2h2ai));
  it('L3: 1H + 3AI solo with bots', () => runScenario(L3_1h3ai));
  it('L5: 4H full human lobby', () => runScenario(L5_4h0ai));
  it('L6: lobby disconnect', () => runScenario(L6_lobbyDisconnect));
  it('L9: mixed death ordering', () => runScenario(L9_mixedDeathOrder));
});
