import { describe, it, expect } from 'vitest';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';

describe('vehicleAudioProfiles', () => {
  it('returns sweep profile for bike (Spectre)', () => {
    const profile = getVehicleAudioProfile('bike');
    expect(profile.strategy).toBe('sweep');
    expect(profile.startup).toBe('engine-on');
    expect(profile.shutdown).toBe('engine-off');
    expect(profile.sweepConfig).toBeDefined();
    expect(profile.passByConfig).toBeDefined();
  });

  it('returns procedural profile for car (Slingshot)', () => {
    const profile = getVehicleAudioProfile('car');
    expect(profile.strategy).toBe('procedural');
    expect(profile.startup).toBe('engine-on');
    expect(profile.shutdown).toBe('engine-off');
    expect(profile.proceduralConfig).toBeDefined();
    expect(profile.sweepConfig).toBeUndefined();
    expect(profile.passByConfig).toBeDefined();
  });

  it('returns procedural profile for hoverboard (Vector)', () => {
    const profile = getVehicleAudioProfile('hoverboard');
    expect(profile.strategy).toBe('procedural');
    expect(profile.proceduralConfig).toBeDefined();
    expect(profile.sweepConfig).toBeUndefined();
    expect(profile.rpmBandConfig).toBeUndefined();
  });

  it('sweep profile tunables have correct structure', () => {
    const profile = getVehicleAudioProfile('bike');
    const sc = profile.sweepConfig!;
    expect(sc.idleFadeEnd).toBeGreaterThan(0);
    expect(sc.sweepFadeStart).toBeGreaterThan(0);
    expect(sc.playbackRateRange).toHaveLength(2);
    expect(sc.noiseCurve).toBeDefined();
    expect(sc.filterCurve).toBeDefined();
    expect(sc.boostQCurve).toBeDefined();
  });

  it('car procedural profile has correct structure', () => {
    const profile = getVehicleAudioProfile('car');
    const pc = profile.proceduralConfig!;
    expect(pc.basePitchIdle).toBe(60);
    expect(pc.basePitchScale).toBe(90);
    expect(pc.masterGainIdle).toBe(0.045);
    expect(pc.smoothing).toBe(0.08);
  });
});
