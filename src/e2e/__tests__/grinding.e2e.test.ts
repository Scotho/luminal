import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  GRIND1_successfulGrind,
  GRIND2_bailRight,
  GRIND3_bailLeft,
  GRIND4_meterRecovery,
  GRIND5_slipstreamDisruption,
  GRIND6_cooldownAndRegrind,
  GRIND7_lockstepDeterminism,
} from '../scenarios/grinding';

describe('Grind Mechanics E2E', () => {
  it('GRIND1: successful grind with balance correction', async () => { await runScenario(GRIND1_successfulGrind); }, 60_000);
  it('GRIND2: bail to the right', async () => { await runScenario(GRIND2_bailRight); }, 60_000);
  it('GRIND3: bail to the left', async () => { await runScenario(GRIND3_bailLeft); }, 60_000);
  it('GRIND4: meter recovery during sweet-spot grinding', async () => { await runScenario(GRIND4_meterRecovery); }, 60_000);
  it('GRIND5: opponent proximity disrupts grind balance', async () => { await runScenario(GRIND5_slipstreamDisruption); }, 60_000);
  it('GRIND6: grind -> cooldown -> second grind', async () => { await runScenario(GRIND6_cooldownAndRegrind); }, 60_000);
  it('GRIND7: lockstep determinism during grind', async () => { await runScenario(GRIND7_lockstepDeterminism); }, 60_000);
});
