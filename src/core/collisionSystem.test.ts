// ── collisionSystem.test.ts ───────────────────────────────
// Unit tests for pure physics functions in collisionSystem.ts.
// Mocks the arena grid module (Three.js heavy) and uses a real
// SpatialGrid instance for spatial queries.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPlayer, ITrail } from '../types/index';

// ── Controlled spatial grid ──────────────────────────────
// vi.mock factories are hoisted — use vi.hoisted to create values that are
// available when the factory runs.

const { testGrid, getOutOfBounds, setOutOfBounds } = vi.hoisted(() => {
  // Inline a minimal spatial grid to avoid the circular hoisting issue.
  // We need real point-to-segment distance math — replicate it here.
  function ptSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-9) return Math.hypot(px - ax, pz - az);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
    return Math.hypot(px - ax - t * dx, pz - az - t * dz);
  }

  type Seg = { ax: number; az: number; bx: number; bz: number; trail: object; segIndex: number };

  class MiniGrid {
    private segs: Seg[] = [];

    clear() { this.segs = []; }

    insertSegment(ax: number, az: number, bx: number, bz: number, trail: object, segIndex: number) {
      this.segs.push({ ax, az, bx, bz, trail, segIndex });
    }

    checkCollision(px: number, pz: number, hitRadius: number, skipTrail: object | null, skipN: number): boolean {
      for (const seg of this.segs) {
        if (skipTrail && seg.trail === skipTrail) {
          const trailLen = (skipTrail as { points: unknown[] }).points?.length ?? 0;
          if (seg.segIndex >= trailLen - 1 - skipN) continue;
        }
        if (ptSegDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz) < hitRadius) return true;
      }
      return false;
    }

    nearestDist(px: number, pz: number, searchRadius: number, skipTrail: object | null, skipN: number): number {
      let minDist = Infinity;
      for (const seg of this.segs) {
        if (skipTrail && seg.trail === skipTrail) {
          const trailLen = (skipTrail as { points: unknown[] }).points?.length ?? 0;
          if (seg.segIndex >= trailLen - 1 - skipN) continue;
        }
        const d = ptSegDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
        if (d < searchRadius && d < minDist) minDist = d;
      }
      return minDist;
    }

    nearestSegment(px: number, pz: number, searchRadius: number, skipTrail: object | null, skipN: number): { seg: Seg | null; dist: number } {
      let minDist = Infinity;
      let nearest: Seg | null = null;
      for (const seg of this.segs) {
        if (skipTrail && seg.trail === skipTrail) {
          const trailLen = (skipTrail as { points: unknown[] }).points?.length ?? 0;
          if (seg.segIndex >= trailLen - 1 - skipN) continue;
        }
        const d = ptSegDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
        if (d < searchRadius && d < minDist) { minDist = d; nearest = seg; }
      }
      return { seg: nearest, dist: minDist };
    }

    segmentsInRange(px: number, pz: number, searchRadius: number, skipTrail: object | null, skipN: number): { seg: Seg; dist: number }[] {
      const results: { seg: Seg; dist: number }[] = [];
      for (const seg of this.segs) {
        if (skipTrail && seg.trail === skipTrail) {
          const trailLen = (skipTrail as { points: unknown[] }).points?.length ?? 0;
          if (seg.segIndex >= trailLen - 1 - skipN) continue;
        }
        const d = ptSegDist(px, pz, seg.ax, seg.az, seg.bx, seg.bz);
        if (d < searchRadius) results.push({ seg, dist: d });
      }
      return results;
    }
  }

  let _oob = false;
  return {
    testGrid: new MiniGrid(),
    getOutOfBounds: () => _oob,
    setOutOfBounds: (v: boolean) => { _oob = v; },
  };
});

vi.mock('../spatialGrid', () => ({
  grid: testGrid,
}));

// ── Mock the arena grid module ────────────────────────────
// grid.ts is a Three.js scene module; we only need isOutOfBounds.
vi.mock('../grid', () => ({
  isOutOfBounds: (_x: number, _z: number) => getOutOfBounds(),
}));

import {
  getCollisionTuning,
  updateProximitySpeed,
  applyWallRepulsion,
  checkCollisions,
  clearEnemySlipstreamVFX,
} from './collisionSystem';

// ── Helpers ───────────────────────────────────────────────

/** Minimal ITrail stub — only `points` and `_segCount` are read by the grid. */
function makeTrail(points: { x: number; z: number }[] = []): ITrail {
  return {
    points,
    get _segCount() { return Math.max(0, points.length - 1); },
    wallMesh: { instanceColor: null } as unknown as ITrail['wallMesh'],
    wallMat: {
      emissive: { r: 1, g: 1, b: 1, clone: () => ({ r: 1, g: 1, b: 1 }) },
      emissiveIntensity: 0,
      setRGB: vi.fn(),
      _baseEmissiveColor: undefined,
    } as unknown as ITrail['wallMat'],
    color: { r: 0.1, g: 0.5, b: 1 },
    _glowingIdxs: null,
  } as unknown as ITrail;
}

/** Minimal IPlayer stub. */
function makePlayer(
  x = 0,
  z = 0,
  overrides: Partial<{
    alive: boolean;
    angle: number;
    speed: number;
    proximitySpeedBoost: number;
    trail: ITrail;
  }> = {},
): IPlayer & { _x: number; _z: number; _killed: boolean } {
  const trail = overrides.trail ?? makeTrail([{ x, z }]);
  const player = {
    _x: x,
    _z: z,
    _killed: false,
    alive: overrides.alive ?? true,
    angle: overrides.angle ?? 0,
    speed: overrides.speed ?? 30,
    meter: 100,
    boosting: false,
    dashing: false,
    proximitySpeedBoost: overrides.proximitySpeedBoost ?? 0,
    trail,
    getPosition() { return { x: this._x, z: this._z }; },
    kill() { this._killed = true; this.alive = false; },
  };
  return player as unknown as IPlayer & { _x: number; _z: number; _killed: boolean };
}

// ── Test Suite ────────────────────────────────────────────

describe('getCollisionTuning', () => {
  it('returns the tuning object with expected shape', () => {
    const t = getCollisionTuning();
    expect(t).toHaveProperty('hitRadius');
    expect(t).toHaveProperty('repulseRange');
    expect(t).toHaveProperty('repulseStrength');
    expect(t).toHaveProperty('proximityRange');
    expect(t).toHaveProperty('headOnDistance');
    expect(t).toHaveProperty('skipOwnSegments');
    expect(t.hitRadius).toBeGreaterThan(0);
    expect(t.repulseRange).toBeGreaterThan(0);
    expect(t.proximityRange).toBeGreaterThan(0);
  });
});

// ── updateProximitySpeed ──────────────────────────────────

describe('updateProximitySpeed', () => {
  beforeEach(() => {
    testGrid.clear();
    setOutOfBounds(false);
  });

  it('does nothing when player is dead', () => {
    const player = makePlayer(0, 0, { alive: false, proximitySpeedBoost: 0 });
    updateProximitySpeed(player);
    expect(player.proximitySpeedBoost).toBe(0);
  });

  it('sets boost to 0 when no trail segments are in range', () => {
    const player = makePlayer(0, 0, { proximitySpeedBoost: 0 });
    // Empty grid — no enemy trails
    updateProximitySpeed(player);
    expect(player.proximitySpeedBoost).toBe(0);
  });

  it('ramps boost toward 1 when an enemy trail segment is very close', () => {
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    // Insert enemy segment right next to the player (at z=0.5, player at z=0)
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    const player = makePlayer(5, 0.5, { proximitySpeedBoost: 0 });
    // Player's own trail is different from the enemy trail above
    updateProximitySpeed(player);

    // Boost should be positive — enemy trail is < 1 unit away
    expect(player.proximitySpeedBoost).toBeGreaterThan(0);
  });

  it('decays boost when enemy trail is no longer in range', () => {
    const player = makePlayer(0, 0, { proximitySpeedBoost: 0.5 });
    // Empty grid — no nearby trails
    updateProximitySpeed(player);
    // Boost should decrease toward 0 (decay, not instant 0)
    expect(player.proximitySpeedBoost).toBeLessThan(0.5);
  });

  it('boost is clamped to 0 when it falls below 0.01', () => {
    const player = makePlayer(0, 0, { proximitySpeedBoost: 0.005 });
    // No enemy segments — target is 0
    updateProximitySpeed(player);
    expect(player.proximitySpeedBoost).toBe(0);
  });

  it('ramps up faster than it decays (different ramp speeds)', () => {
    const tuning = getCollisionTuning();
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    // Ramp up from 0
    const playerUp = makePlayer(5, 1, { proximitySpeedBoost: 0 });
    updateProximitySpeed(playerUp);
    const upDelta = playerUp.proximitySpeedBoost;

    testGrid.clear();
    // Decay from same level — no trail nearby
    const playerDown = makePlayer(5, 1, { proximitySpeedBoost: upDelta });
    updateProximitySpeed(playerDown);
    const downDelta = upDelta - playerDown.proximitySpeedBoost;

    // Ramp-up rate (8) > decay rate (3), so upDelta > downDelta
    expect(upDelta).toBeGreaterThan(downDelta);
  });

  it('boost stays at 0 when the only nearby trail is the player\'s own', () => {
    // Own trail — same reference as player.trail
    const ownTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    testGrid.insertSegment(0, 0, 10, 0, ownTrail, 0);

    // Player's own trail is the same object — grid.nearestDist skips it
    const player = makePlayer(5, 0.5, { trail: ownTrail, proximitySpeedBoost: 0 });
    updateProximitySpeed(player);

    // Should remain 0 since own trail is excluded
    expect(player.proximitySpeedBoost).toBe(0);
  });
});

// ── applyWallRepulsion ────────────────────────────────────

describe('applyWallRepulsion', () => {
  beforeEach(() => {
    testGrid.clear();
    setOutOfBounds(false);
  });

  it('does nothing when player is dead', () => {
    const player = makePlayer(0, 0, { alive: false, angle: 0 });
    const initialAngle = player.angle;
    applyWallRepulsion(player, 1 / 60, 'local');
    expect(player.angle).toBe(initialAngle);
  });

  it('does nothing when grid has no nearby segments', () => {
    const player = makePlayer(0, 0, { angle: Math.PI / 2 });
    const initialAngle = player.angle;
    applyWallRepulsion(player, 1 / 60, 'local');
    expect(player.angle).toBe(initialAngle);
  });

  it('nudges player angle when approaching a nearby trail wall', () => {
    const tuning = getCollisionTuning();
    const wallTrail = makeTrail([{ x: -50, z: 2 }, { x: 50, z: 2 }]);
    // Horizontal wall segment at z=2, player at z=0 heading toward z=+
    testGrid.insertSegment(-50, 2, 50, 2, wallTrail, 0);

    // Facing toward the wall: angle=0 means fwd is (-sin0, -cos0) = (0, -1)
    // Wall is at z=2 relative to player at z=0, so player faces away from wall.
    // Use angle=Math.PI so player faces toward z=+2 (fwd = (0, +1))
    const player = makePlayer(0, 0, { angle: Math.PI });
    const initialAngle = player.angle;
    applyWallRepulsion(player, 1 / 60, 'local');

    // Angle should have been nudged — either direction depending on cross product
    expect(player.angle).not.toBe(initialAngle);
  });

  it('does not repulse when segment is beyond repulseRange', () => {
    const tuning = getCollisionTuning();
    // Place wall far beyond repulseRange
    const farTrail = makeTrail([{ x: -50, z: 100 }, { x: 50, z: 100 }]);
    testGrid.insertSegment(-50, 100, 50, 100, farTrail, 0);

    const player = makePlayer(0, 0, { angle: Math.PI });
    const initialAngle = player.angle;
    applyWallRepulsion(player, 1 / 60, 'local');
    expect(player.angle).toBe(initialAngle);
  });

  it('repulsion magnitude scales with proximity (closer = stronger nudge)', () => {
    const makeWallAt = (wallZ: number, playerAngle: number) => {
      testGrid.clear();
      const wallTrail = makeTrail([{ x: -50, z: wallZ }, { x: 50, z: wallZ }]);
      testGrid.insertSegment(-50, wallZ, 50, wallZ, wallTrail, 0);
      const p = makePlayer(0, 0, { angle: playerAngle });
      applyWallRepulsion(p, 1 / 60, 'local');
      return Math.abs(p.angle - playerAngle);
    };

    // Player facing toward +z (angle=PI), wall closer at z=1 vs z=5
    const closeNudge = makeWallAt(1.5, Math.PI);
    const farNudge = makeWallAt(5, Math.PI);

    expect(closeNudge).toBeGreaterThan(farNudge);
  });
});

// ── checkCollisions ───────────────────────────────────────

describe('checkCollisions', () => {
  beforeEach(() => {
    testGrid.clear();
    setOutOfBounds(false);
  });

  it('returns null when player is dead', () => {
    const player = makePlayer(0, 0, { alive: false });
    const ai = { player: makePlayer(10, 0) };
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).toBeNull();
  });

  it('returns null when all AIs are dead', () => {
    const player = makePlayer(0, 0);
    const ai = { player: makePlayer(10, 0, { alive: false }) };
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).toBeNull();
  });

  it('returns null when no collisions occur', () => {
    const player = makePlayer(0, 0);
    const ai = { player: makePlayer(100, 100) };
    // No trail segments in grid, players far apart
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).toBeNull();
  });

  it('kills player when out of bounds', () => {
    setOutOfBounds(true);
    const player = makePlayer(0, 0) as ReturnType<typeof makePlayer>;
    const ai = { player: makePlayer(10, 0) };
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).not.toBeNull();
    expect(result!.playerDied).toBe(true);
    expect(player._killed).toBe(true);
  });

  it('kills player when colliding with a trail segment', () => {
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    // Insert segment at z=0; player is at z=0.3 which is within HIT_RADIUS (0.8)
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    const player = makePlayer(5, 0.3) as ReturnType<typeof makePlayer>;
    const ai = { player: makePlayer(50, 50) };
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).not.toBeNull();
    expect(result!.playerDied).toBe(true);
    expect(player._killed).toBe(true);
  });

  it('does not kill player when trail segment is beyond HIT_RADIUS', () => {
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    // Trail at z=0, player at z=5 — well outside HIT_RADIUS (0.8)
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    const player = makePlayer(5, 5) as ReturnType<typeof makePlayer>;
    const ai = { player: makePlayer(50, 50) };
    const result = checkCollisions(player, [ai], 'local', null);
    expect(result).toBeNull();
  });

  it('kills AI when AI collides with a trail segment', () => {
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    // Player is safe (far away), AI collides with trail
    const player = makePlayer(50, 50) as ReturnType<typeof makePlayer>;
    const aiPlayer = makePlayer(5, 0.3) as ReturnType<typeof makePlayer>;
    const result = checkCollisions(player, [{ player: aiPlayer }], 'local', null);
    expect(result).not.toBeNull();
    expect(result!.anyAiDied).toBe(true);
    expect(aiPlayer._killed).toBe(true);
  });

  it('kills both players on head-on collision within headOnDistance', () => {
    const tuning = getCollisionTuning();
    // Place players within headOnDistance of each other
    const dist = tuning.headOnDistance * 0.5;
    const player = makePlayer(0, 0) as ReturnType<typeof makePlayer>;
    const aiPlayer = makePlayer(dist, 0) as ReturnType<typeof makePlayer>;

    const result = checkCollisions(player, [{ player: aiPlayer }], 'local', null);
    expect(result).not.toBeNull();
    expect(result!.playerDied).toBe(true);
    expect(result!.anyAiDied).toBe(true);
    expect(player._killed).toBe(true);
    expect(aiPlayer._killed).toBe(true);
  });

  it('does not trigger head-on collision when players are beyond headOnDistance', () => {
    const tuning = getCollisionTuning();
    // Place players just outside headOnDistance
    const dist = tuning.headOnDistance * 2;
    const player = makePlayer(0, 0) as ReturnType<typeof makePlayer>;
    const aiPlayer = makePlayer(dist, 0) as ReturnType<typeof makePlayer>;

    const result = checkCollisions(player, [{ player: aiPlayer }], 'local', null);
    expect(result).toBeNull();
    expect(player._killed).toBe(false);
    expect(aiPlayer._killed).toBe(false);
  });

  it('reports online deaths via reportLocalDeath in online mode', async () => {
    setOutOfBounds(true);
    const player = makePlayer(0, 0);
    const ai = { player: makePlayer(10, 0) };
    const reportLocalDeath = vi.fn();
    const onlineMatch = {
      myUid: 'uid-player',
      opponentUid: 'uid-ai',
      reportLocalDeath,
    };

    checkCollisions(player, [ai], 'online', onlineMatch);
    // reportLocalDeath is deferred via Promise.resolve()
    await Promise.resolve();
    expect(reportLocalDeath).toHaveBeenCalledWith('uid-player');
  });

  it('does not call reportLocalDeath in local mode', async () => {
    setOutOfBounds(true);
    const player = makePlayer(0, 0);
    const ai = { player: makePlayer(10, 0) };
    const reportLocalDeath = vi.fn();
    const onlineMatch = {
      myUid: 'uid-player',
      opponentUid: 'uid-ai',
      reportLocalDeath,
    };

    checkCollisions(player, [ai], 'local', onlineMatch);
    await Promise.resolve();
    expect(reportLocalDeath).not.toHaveBeenCalled();
  });

  it('handles multiple AIs — kills only those in collision', () => {
    const enemyTrail = makeTrail([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    testGrid.insertSegment(0, 0, 10, 0, enemyTrail, 0);

    const player = makePlayer(50, 50) as ReturnType<typeof makePlayer>;
    const safeAi = makePlayer(80, 80) as ReturnType<typeof makePlayer>;  // far from trail and player
    const deadAi = makePlayer(5, 0.3) as ReturnType<typeof makePlayer>;  // on trail

    const result = checkCollisions(
      player,
      [{ player: safeAi }, { player: deadAi }],
      'local',
      null,
    );

    expect(result).not.toBeNull();
    expect(result!.anyAiDied).toBe(true);
    expect(safeAi._killed).toBe(false);
    expect(deadAi._killed).toBe(true);
  });
});

// ── clearEnemySlipstreamVFX ───────────────────────────────

describe('clearEnemySlipstreamVFX', () => {
  it('runs without throwing even when state is empty', () => {
    expect(() => clearEnemySlipstreamVFX()).not.toThrow();
  });
});
