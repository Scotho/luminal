import { describe, it, expect } from 'vitest';
import { createAIState, AI_SKIP_OWN, tryStartManeuver, DIFFICULTY_PRESETS } from './ai';

// Mulberry32 PRNG — matches src/core/seededRandom.ts
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createAIState', () => {
  it('returns an object with all required fields', () => {
    const state = createAIState();
    expect(state).toHaveProperty('personality');
    expect(state).toHaveProperty('personalityTimer');
    expect(state).toHaveProperty('maneuver');
    expect(state).toHaveProperty('maneuverCooldown');
    expect(state).toHaveProperty('trappedTimer');
    expect(state).toHaveProperty('trappedSuicideAt');
    expect(state).toHaveProperty('fidgetTimer');
    expect(state).toHaveProperty('fidgetValue');
    expect(state).toHaveProperty('fidgetDuration');
    expect(state).toHaveProperty('lastPlayerAngle');
    expect(state).toHaveProperty('lastPlayerPos');
    expect(state).toHaveProperty('reactionDelay');
    expect(state).toHaveProperty('accelCommit');
    expect(state).toHaveProperty('accelCooldown');
  });

  it('starts with null personality (lazy init)', () => {
    const state = createAIState();
    expect(state.personality).toBeNull();
  });

  it('starts with no active maneuver', () => {
    const state = createAIState();
    expect(state.maneuver).toBeNull();
    expect(state.maneuverCooldown).toBe(0);
  });

  it('starts with zero timers', () => {
    const state = createAIState();
    expect(state.personalityTimer).toBe(0);
    expect(state.trappedTimer).toBe(0);
    expect(state.fidgetTimer).toBe(0);
    expect(state.accelCommit).toBe(0);
    expect(state.accelCooldown).toBe(0);
  });

  it('trappedSuicideAt is randomized between 8 and 15', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const state = createAIState();
      expect(state.trappedSuicideAt).toBeGreaterThanOrEqual(8);
      expect(state.trappedSuicideAt).toBeLessThanOrEqual(15);
      values.add(Math.round(state.trappedSuicideAt));
    }
    // Should have some variation (not all the same value)
    expect(values.size).toBeGreaterThan(1);
  });

  it('starts with null tracking state', () => {
    const state = createAIState();
    expect(state.lastPlayerAngle).toBeNull();
    expect(state.lastPlayerPos).toBeNull();
  });

  it('creates independent instances', () => {
    const s1 = createAIState();
    const s2 = createAIState();
    s1.personalityTimer = 999;
    expect(s2.personalityTimer).toBe(0);
  });

  it('has drift fields for car AI', () => {
    const state = createAIState();
    expect(state.driftCommit).toBe(0);
    expect(state.driftCooldown).toBe(0);
    expect(state.driftExitTimer).toBe(0);
  });

  it('defaults difficulty to medium', () => {
    const state = createAIState();
    expect(state.difficulty).toBe('medium');
  });

  it('accepts explicit difficulty', () => {
    expect(createAIState(undefined, 'easy').difficulty).toBe('easy');
    expect(createAIState(undefined, 'hard').difficulty).toBe('hard');
  });
});

describe('AI determinism', () => {
  it('two instances with same seed produce identical personality', () => {
    const seed = 42;
    const s1 = createAIState(seededRandom(seed));
    const s2 = createAIState(seededRandom(seed));

    // Force personality initialization by accessing rng the same number of times
    // Personality is lazy-initialized on first getAIInput call, but we can test
    // that the same seed produces the same trappedSuicideAt
    expect(s1.trappedSuicideAt).toBe(s2.trappedSuicideAt);
  });

  it('different seeds produce different personalities', () => {
    const s1 = createAIState(seededRandom(1));
    const s2 = createAIState(seededRandom(99999));
    // Very unlikely to be identical with different seeds
    expect(s1.trappedSuicideAt).not.toBe(s2.trappedSuicideAt);
  });

  it('seeded RNG produces consistent sequence', () => {
    const rng1 = seededRandom(12345);
    const rng2 = seededRandom(12345);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });
});

describe('AI_SKIP_OWN constant', () => {
  it('is 10 to match collision system skipOwnSegments', () => {
    expect(AI_SKIP_OWN).toBe(10);
  });
});

describe('tryStartManeuver', () => {
  function makeState(rngValue: number) {
    let callIndex = 0;
    const state = createAIState(() => {
      callIndex++;
      // Call 1: trappedSuicideAt, Call 2: reactionDelay
      // Call 3: the roll inside tryStartManeuver
      if (callIndex === 3) return rngValue;
      return 0.5;
    });
    state.personality = {
      aggression: 0.7, wallFear: 0.8, straightBias: 0.08,
      jitterAmount: 0.05, dashAggression: 0.7, moodSwingRate: 6,
      turniness: 0.6, cutoffSkill: 0.7, escapeSkill: 0.7,
    };
    return state;
  }

  const playerInfo = { px: 30, pz: 0, hdx: 0, hdz: -1, turnRate: 0, speed: 40 };

  it('uturn is reachable when player is in range (roll 0.09)', () => {
    const state = makeState(0.09);
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('uturn');
  });

  it('attack triggers in its probability band (roll 0.15)', () => {
    const state = makeState(0.15);
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('attack');
  });

  it('no maneuver when roll exceeds all thresholds', () => {
    const state = makeState(0.95);
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver).toBeNull();
  });

  it('skips when maneuver already active', () => {
    const state = makeState(0.01);
    state.maneuver = { type: 'attack', timer: 0, duration: 2 };
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('attack');
  });

  it('attack duration is 1.5-3.0s', () => {
    const state = makeState(0.15);
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('attack');
    expect(state.maneuver!.duration).toBeGreaterThanOrEqual(1.5);
    expect(state.maneuver!.duration).toBeLessThanOrEqual(3.0);
  });

  it('snake triggers for very low rolls', () => {
    const state = makeState(0.03);
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('snake');
  });

  it('easy difficulty never triggers attack maneuver', () => {
    let callIndex = 0;
    const state = createAIState(() => {
      callIndex++;
      if (callIndex === 3) return 0.15; // would be attack on medium
      return 0.5;
    }, 'easy');
    state.personality = {
      aggression: 0.7, wallFear: 0.8, straightBias: 0.08,
      jitterAmount: 0.05, dashAggression: 0.7, moodSwingRate: 6,
      turniness: 0.6, cutoffSkill: 0.7, escapeSkill: 0.7,
    };
    const playerInfo = { px: 30, pz: 0, hdx: 0, hdz: -1, turnRate: 0, speed: 40 };
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    if (state.maneuver) {
      expect(state.maneuver.type).not.toBe('attack');
    }
  });

  it('hard difficulty has wider attack band', () => {
    let callIndex = 0;
    const state = createAIState(() => {
      callIndex++;
      if (callIndex === 3) return 0.28; // above medium (0.22) but within hard (0.30)
      return 0.5;
    }, 'hard');
    state.personality = {
      aggression: 0.7, wallFear: 0.8, straightBias: 0.08,
      jitterAmount: 0.05, dashAggression: 0.7, moodSwingRate: 6,
      turniness: 0.6, cutoffSkill: 0.7, escapeSkill: 0.7,
    };
    const playerInfo = { px: 30, pz: 0, hdx: 0, hdz: -1, turnRate: 0, speed: 40 };
    tryStartManeuver(state, 0, 0, 0, 90, 90, 40, playerInfo, 0.7);
    expect(state.maneuver?.type).toBe('attack');
  });
});

describe('DIFFICULTY_PRESETS', () => {
  it('has entries for all three difficulties', () => {
    expect(DIFFICULTY_PRESETS).toHaveProperty('easy');
    expect(DIFFICULTY_PRESETS).toHaveProperty('medium');
    expect(DIFFICULTY_PRESETS).toHaveProperty('hard');
  });

  it('easy has lower aggression than medium', () => {
    const e = DIFFICULTY_PRESETS.easy;
    const m = DIFFICULTY_PRESETS.medium;
    expect(e.aggression[0] + e.aggression[1]).toBeLessThan(m.aggression[0] + m.aggression[1]);
  });

  it('hard has higher cutoffSkill than medium', () => {
    const h = DIFFICULTY_PRESETS.hard;
    const m = DIFFICULTY_PRESETS.medium;
    expect(h.cutoffSkill[0]).toBeGreaterThan(m.cutoffSkill[0]);
  });

  it('easy has shorter lookahead than hard', () => {
    expect(DIFFICULTY_PRESETS.easy.lookaheadMult).toBeLessThan(DIFFICULTY_PRESETS.hard.lookaheadMult);
  });

  it('easy has attack disabled', () => {
    expect(DIFFICULTY_PRESETS.easy.attackEnabled).toBe(false);
  });

  it('hard has more angle offsets than medium', () => {
    expect(DIFFICULTY_PRESETS.hard.angleOffsets.length).toBeGreaterThan(DIFFICULTY_PRESETS.medium.angleOffsets.length);
  });
});

describe('resetPersonality with difficulty', () => {
  it('easy personality has low aggression range', () => {
    const preset = DIFFICULTY_PRESETS.easy;
    const maxAggression = preset.aggression[0] + preset.aggression[1];
    expect(maxAggression).toBeLessThan(0.5);
  });

  it('hard personality has high cutoff skill range', () => {
    const preset = DIFFICULTY_PRESETS.hard;
    const minCutoff = preset.cutoffSkill[0];
    expect(minCutoff).toBeGreaterThanOrEqual(0.9);
  });

  it('easy createAIState sets reaction delay > 0', () => {
    const state = createAIState(() => 0.5, 'easy');
    expect(state.reactionDelay).toBeGreaterThan(0);
  });

  it('medium createAIState sets reaction delay = 0', () => {
    const state = createAIState(() => 0.5, 'medium');
    expect(state.reactionDelay).toBe(0);
  });

  it('hard createAIState sets reaction delay = 0', () => {
    const state = createAIState(() => 0.5, 'hard');
    expect(state.reactionDelay).toBe(0);
  });
});
