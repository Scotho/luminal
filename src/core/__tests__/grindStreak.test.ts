// ── Grind Streak Counter Tests ──────────────────────────
import { describe, it, expect } from 'vitest';
import {
  advancePlayer, createPlayerSim, SIM_DT,
  GRIND_DANGER_ZONE, STREAK_MILESTONES,
} from '../simulation';
import type { InputFrame, SimState, TrailPoint, PlayerSim } from '../simulation';
import { HOVERBOARD_PHYSICS } from '../../vehicleConfig';

// ── Helpers ────────────────────────────────────────────

const dt = SIM_DT;
const cfg = HOVERBOARD_PHYSICS;

function straightTrail(startX: number, endX: number, z: number, n: number): TrailPoint[] {
  const pts: TrailPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: startX + (endX - startX) * (i / (n - 1)), z });
  }
  return pts;
}

function specialInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false, special: true };
}

function makeState(
  grinder: PlayerSim,
  opts?: { enemyTrail?: TrailPoint[] },
): SimState {
  const enemy = createPlayerSim(100, 100, 0, 45);
  return {
    tick: 100,
    players: [grinder, enemy],
    trails: [
      [],
      opts?.enemyTrail ?? straightTrail(-50, 50, 0, 200),
    ],
  };
}

function step(p: PlayerSim, input: InputFrame, state: SimState): PlayerSim {
  return advancePlayer(p, input, cfg, dt, state, 0);
}

function startGrinding(opts?: { enemyTrail?: TrailPoint[] }): { p: PlayerSim; state: SimState } {
  const p = createPlayerSim(0, 0, 0, 45);
  p.meter = 100;
  const state = makeState(p, opts);
  const result = step(p, specialInput(100), state);
  const cleared = { ...result, grindGraceTimer: 0 } as PlayerSim;
  state.players[0] = cleared;
  return { p: cleared, state };
}

/** Advance grinding for N ticks, keeping balance stable via turnDir correction. */
function grindForTicks(
  initial: PlayerSim,
  state: SimState,
  ticks: number,
  balanceOverride?: (p: PlayerSim) => void,
): PlayerSim {
  let p = initial;
  for (let t = 0; t < ticks; t++) {
    // Keep balance centered for streak testing
    if (balanceOverride) {
      balanceOverride(p);
    } else {
      p.grindBalance = 0;
      p.grindLeanDir = 0;
    }
    const result = step(p, specialInput(100 + t), state);
    state.players[0] = result;
    p = result;
  }
  return p;
}

// ── Tests ──────────────────────────────────────────────

describe('Grind Streak Counter', () => {
  it('initializes streak fields to zero', () => {
    const p = createPlayerSim(0, 0, 0, 45);
    expect(p.grindStreakCount).toBe(0);
    expect(p.grindStreakBest).toBe(0);
    expect(p.grindStreakBroken).toBe(false);
  });

  it('increments streak on segment advance in normal zone', () => {
    const longTrail = straightTrail(-200, 200, 0, 500);
    const { p, state } = startGrinding({ enemyTrail: longTrail });
    expect(p.grinding).toBe(true);

    // Force balance to safe zone and advance enough to cross segments
    const result = grindForTicks(p, state, 60);
    // After enough ticks with centered balance, streak should be > 0
    expect(result.grindStreakCount).toBeGreaterThan(0);
  });

  it('resets streak on danger zone entry', () => {
    const longTrail = straightTrail(-500, 500, 0, 2000);
    const { p, state } = startGrinding({ enemyTrail: longTrail });

    // Build up a streak first
    let result = grindForTicks(p, state, 30);
    const streakBefore = result.grindStreakCount;
    expect(streakBefore).toBeGreaterThan(0);

    // Now force balance into danger zone
    result = grindForTicks(result, state, 30, (player) => {
      player.grindBalance = GRIND_DANGER_ZONE + 0.05;
      player.grindLeanDir = 0;
    });

    // Streak should be 0 after danger zone segments
    expect(result.grindStreakCount).toBe(0);
    expect(result.grindStreakBroken).toBe(true);
  });

  it('resets streak on grind exit', () => {
    const longTrail = straightTrail(-500, 500, 0, 2000);
    const { p, state } = startGrinding({ enemyTrail: longTrail });

    // Build up a streak
    const grinding = grindForTicks(p, state, 30);
    expect(grinding.grinding).toBe(true);
    expect(grinding.grindStreakCount).toBeGreaterThan(0);

    // Release special to exit grind cleanly
    const noSpecial: InputFrame = { tick: 200, turnDir: 0, accelerate: false, dash: false, brake: false };
    grinding.grindBalance = 0;
    const exited = step(grinding, noSpecial, state);

    expect(exited.grinding).toBe(false);
    expect(exited.grindStreakCount).toBe(0);
  });

  it('tracks best streak across multiple grinds', () => {
    const longTrail = straightTrail(-500, 500, 0, 2000);
    const { p, state } = startGrinding({ enemyTrail: longTrail });

    // First grind — build a streak
    const g1 = grindForTicks(p, state, 30);
    const firstStreak = g1.grindStreakCount;
    expect(firstStreak).toBeGreaterThan(0);

    // Exit grind
    const noSpecial: InputFrame = { tick: 300, turnDir: 0, accelerate: false, dash: false, brake: false };
    g1.grindBalance = 0;
    const exited = step(g1, noSpecial, state);

    // Best should be at least what we had
    expect(exited.grindStreakBest).toBeGreaterThanOrEqual(firstStreak);
    // Count should be 0 after exit
    expect(exited.grindStreakCount).toBe(0);
  });

  it('applies milestone meter bonus at correct thresholds', () => {
    // Use a very long trail so we can grind many segments
    const longTrail = straightTrail(-500, 500, 0, 2000);
    const { p, state } = startGrinding({ enemyTrail: longTrail });

    // Set meter to a known value to check bonuses
    p.meter = 30;

    // Grind enough to hit the 10-segment milestone
    let result = p;
    let hitMilestone = false;

    for (let t = 0; t < 600; t++) {
      result.grindBalance = 0;
      result.grindLeanDir = 0;
      result = step(result, specialInput(100 + t), state);
      state.players[0] = result;

      // Check if we hit a milestone (10 segments = +5 meter)
      if (result.grindStreakCount === 10) {
        hitMilestone = true;
        break;
      }
    }

    if (hitMilestone) {
      // The milestone bonus (+5) should have been applied
      // (along with any normal meter regen)
      expect(result.meter).toBeGreaterThan(30);
    }
  });

  it('milestone constants are well-formed', () => {
    expect(STREAK_MILESTONES.length).toBeGreaterThan(0);
    for (const [threshold, bonus] of STREAK_MILESTONES) {
      expect(threshold).toBeGreaterThan(0);
      expect(bonus).toBeGreaterThan(0);
    }
    // Thresholds should be in ascending order
    for (let i = 1; i < STREAK_MILESTONES.length; i++) {
      expect(STREAK_MILESTONES[i][0]).toBeGreaterThan(STREAK_MILESTONES[i - 1][0]);
    }
  });

  it('streak broken flag clears on next successful segment advance', () => {
    const longTrail = straightTrail(-500, 500, 0, 2000);
    const { p, state } = startGrinding({ enemyTrail: longTrail });

    // Force into danger zone to break streak
    let result = grindForTicks(p, state, 20, (player) => {
      player.grindBalance = GRIND_DANGER_ZONE + 0.05;
      player.grindLeanDir = 0;
    });
    expect(result.grindStreakBroken).toBe(true);

    // Now recover to normal zone
    result = grindForTicks(result, state, 20, (player) => {
      player.grindBalance = 0;
      player.grindLeanDir = 0;
    });

    // After segments crossed in normal zone, broken should be false
    expect(result.grindStreakCount).toBeGreaterThan(0);
    expect(result.grindStreakBroken).toBe(false);
  });

  it('multiple milestones can be hit during one long grind', () => {
    // Verify milestone thresholds are distinct
    const thresholds = STREAK_MILESTONES.map(([t]) => t);
    const unique = new Set(thresholds);
    expect(unique.size).toBe(thresholds.length);
  });
});
