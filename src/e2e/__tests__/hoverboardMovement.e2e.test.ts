import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  HB1_surfyTurnRampUp,
  HB2_speedBleedOnTurn,
  HB3_cannotDrift,
  HB4_boostDashMeter,
  HB5_slipstreamBoost,
  HB6_lowMeterEmergencyRegen,
  HB7_lockstepDeterminism,
  HB8_mixedVehicleLockstep,
} from '../scenarios/hoverboardMovement';

describe('Hoverboard Movement E2E', () => {
  describe('Turn feel', () => {
    it('HB1: surfy turn ramp-up and decay', async () => { await runScenario(HB1_surfyTurnRampUp); }, 30_000);
    it('HB2: speed bleed on hard turns', async () => { await runScenario(HB2_speedBleedOnTurn); }, 30_000);
  });

  describe('Physics guards', () => {
    it('HB3: hoverboard cannot drift', async () => { await runScenario(HB3_cannotDrift); }, 30_000);
  });

  describe('Meter economy', () => {
    it('HB4: boost/dash meter economy', async () => { await runScenario(HB4_boostDashMeter); }, 30_000);
    it('HB6: low meter emergency regen', async () => { await runScenario(HB6_lowMeterEmergencyRegen); }, 60_000);
  });

  describe('Slipstream', () => {
    it('HB5: slipstream speed boost applies', async () => { await runScenario(HB5_slipstreamBoost); }, 30_000);
  });

  describe('Lockstep determinism', () => {
    it('HB7: cross-client hash agreement during complex maneuvers', async () => { await runScenario(HB7_lockstepDeterminism); }, 30_000);
    it('HB8: mixed vehicle lockstep (hoverboard vs car)', async () => { await runScenario(HB8_mixedVehicleLockstep); }, 30_000);
  });
});
