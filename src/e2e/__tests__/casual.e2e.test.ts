import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  C1_fullCasualRound,
  C2_casualDisconnect,
  C3_simultaneousDeath,
  C4_inputLossBurst,
  C5_rollbackStress,
} from '../scenarios/casual';

describe('Casual Match E2E (T1 — Loopback)', () => {
  it('C1: full round to death', () => runScenario(C1_fullCasualRound));
  it('C2: disconnect mid-round', () => runScenario(C2_casualDisconnect));
  it('C3: simultaneous death', () => runScenario(C3_simultaneousDeath));
  it('C4: input loss burst', () => runScenario(C4_inputLossBurst));
  it('C5: rollback stress', () => runScenario(C5_rollbackStress));
});
