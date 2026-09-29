import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  D1_driftEntry,
  D2_driftMeterRegen,
  D3_driftExit,
  D4_snapRecovery,
  D5_bikeCannotDrift,
  SL1_slipstreamActivation,
  SL2_carNoSlipstreamSpeed,
} from '../scenarios/vehicleMechanics';

describe('Vehicle Mechanics E2E', () => {
  describe('Drift (car)', () => {
    it('D1: drift entry + slip angle', async () => { await runScenario(D1_driftEntry); }, 30_000);
    it('D2: drift meter regen', async () => { await runScenario(D2_driftMeterRegen); }, 30_000);
    it('D3: drift exit on brake release', async () => { await runScenario(D3_driftExit); }, 30_000);
    it('D4: snap recovery', async () => { await runScenario(D4_snapRecovery); }, 30_000);
    it('D5: bike cannot drift', async () => { await runScenario(D5_bikeCannotDrift); }, 30_000);
  });

  describe('Slipstream', () => {
    it('SL1: slipstream boost activation (bike)', async () => { await runScenario(SL1_slipstreamActivation); }, 30_000);
    it('SL2: car proximity computed but speed not boosted', async () => { await runScenario(SL2_carNoSlipstreamSpeed); }, 30_000);
  });
});
