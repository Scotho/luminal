import { describe, it } from 'vitest';
import { runScenario } from '../scenarioRunner';
import {
  VS1_bikeVsBike,
  VS2_carVsCar,
  VS3_bikeVsCar,
  VS4_hoverboardPhysics,
  VS5_mixedLobby3Vehicle,
  VS6_allHoverboard4Player,
  VS7_casualMixedVehicle,
} from '../scenarios/vehicleSelection';

describe('Vehicle Selection E2E', () => {
  it('VS1: bike vs bike (control)', async () => { await runScenario(VS1_bikeVsBike); }, 30_000);
  it('VS2: car vs car', async () => { await runScenario(VS2_carVsCar); }, 30_000);
  it('VS3: bike vs car (mixed baseline)', async () => { await runScenario(VS3_bikeVsCar); }, 30_000);
  it('VS4: hoverboard vs hoverboard', async () => { await runScenario(VS4_hoverboardPhysics); }, 30_000);
  it('VS5: mixed lobby (bike + car AI + hoverboard AI)', async () => { await runScenario(VS5_mixedLobby3Vehicle); }, 30_000);
  it('VS6: 4-player all hoverboard', async () => { await runScenario(VS6_allHoverboard4Player); }, 30_000);
  it('VS7: casual match bike vs car', async () => { await runScenario(VS7_casualMixedVehicle); }, 30_000);
});
