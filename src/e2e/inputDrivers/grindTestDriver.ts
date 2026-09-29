// ── Grind Test Input Driver ─────────────────────────────
// Reactive driver that navigates toward enemy trails and grinds them.
// For E2E testing of the grind system — not a real AI.

import type { InputFrame, SimState, TrailPoint } from '../../core/simulation';
import { GRIND_SNAP_RANGE, GRIND_DANGER_ZONE } from '../../core/simulation';
import type { InputDriver } from './types';

type Phase = 'evade' | 'approach' | 'grind' | 'recover' | 'idle';

export interface GrindTestDriverOpts {
  /** Tick to start seeking a trail. Default: 60 (1s of trail-building time). */
  startTick?: number;
  /** How many ticks to hold the grind before voluntarily dismounting. 0 = ride until bail/trail end. */
  grindDuration?: number;
  /** If true, intentionally wiggle to cause a bail. */
  forceBail?: boolean;
  /** Bail direction: 'left' | 'right'. Only used when forceBail=true. */
  bailSide?: 'left' | 'right';
  /** Max ticks before the driver gives up. */
  maxTicks?: number;
}

function neutralInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
}

export class GrindTestDriver implements InputDriver {
  private _opts: Required<GrindTestDriverOpts>;
  private _phase: Phase = 'idle';
  private _grindStartTick = 0;
  private _recoveryStartTick = 0;

  constructor(opts: GrindTestDriverOpts = {}) {
    this._opts = {
      startTick: opts.startTick ?? 60,
      grindDuration: opts.grindDuration ?? 0,
      forceBail: opts.forceBail ?? false,
      bailSide: opts.bailSide ?? 'right',
      maxTicks: opts.maxTicks ?? 1800,
    };
  }

  getInput(tick: number, state: SimState, playerIndex: number): InputFrame {
    if (tick < this._opts.startTick) return neutralInput(tick);

    const me = state.players[playerIndex];
    if (!me || !me.alive) return neutralInput(tick);

    // Detect state transitions from sim
    if (me.grinding && this._phase !== 'grind') {
      this._phase = 'grind';
      this._grindStartTick = tick;
    }
    if (!me.grinding && this._phase === 'grind') {
      this._phase = 'recover';
      this._recoveryStartTick = tick;
    }
    if (this._phase === 'recover' && !me.airborne && !me.recovery && me.grindCooldown <= 0) {
      this._phase = 'idle';
    }

    switch (this._phase) {
      case 'idle':
      case 'evade':
        // First phase: turn right to avoid head-on collision with opponent trail
        // (spawns face inward; trails cross near center)
        // Use moderate turn to carve a wide arc, not a tight circle
        if (tick < this._opts.startTick + 150) {
          this._phase = 'evade';
          return { tick, turnDir: 0.5, accelerate: true, dash: false, brake: false };
        }
        this._phase = 'approach';
        // fall through
      case 'approach':
        return this._approachTrail(tick, state, playerIndex);
      case 'grind':
        return this._duringGrind(tick, state, playerIndex);
      case 'recover':
        return neutralInput(tick);
      default:
        return neutralInput(tick);
    }
  }

  private _approachTrail(tick: number, state: SimState, playerIndex: number): InputFrame {
    this._phase = 'approach';
    const me = state.players[playerIndex];

    // Find nearest enemy trail segment and its direction
    let bestDist = Infinity;
    let bestIdx = -1;
    let bestTrailIdx = -1;
    for (let t = 0; t < state.trails.length; t++) {
      if (t === playerIndex) continue;
      const trail = state.trails[t];
      if (!trail || trail.length < 2) continue;
      for (let i = 0; i < trail.length; i++) {
        const dx = trail[i].x - me.x;
        const dz = trail[i].z - me.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          bestTrailIdx = t;
        }
      }
    }

    if (bestTrailIdx < 0) {
      // No enemy trail yet — drive toward enemy to get near their future trail
      const enemy = state.players.find((_, i) => i !== playerIndex);
      if (enemy && enemy.alive) {
        const dx = enemy.x - me.x;
        const dz = enemy.z - me.z;
        const targetAngle = Math.atan2(-dx, -dz);
        const angleDiff = ((targetAngle - me.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const turnDir = angleDiff > 0.05 ? 1 : angleDiff < -0.05 ? -1 : 0;
        return { tick, turnDir, accelerate: true, dash: false, brake: false };
      }
      return { ...neutralInput(tick), accelerate: true };
    }

    const trail = state.trails[bestTrailIdx];

    // When far, steer directly toward the trail
    // When close, ALIGN with trail direction to approach parallel (avoid head-on collision)
    if (bestDist > 15) {
      // Far — simple steer-toward
      const dx = trail[bestIdx].x - me.x;
      const dz = trail[bestIdx].z - me.z;
      const targetAngle = Math.atan2(-dx, -dz);
      const angleDiff = ((targetAngle - me.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turnDir = Math.max(-1, Math.min(1, angleDiff * 2));
      return { tick, turnDir, accelerate: true, dash: false, brake: false };
    }

    // Close — align with trail direction and drift toward it
    // Find trail direction at nearest point
    const prevIdx = Math.max(0, bestIdx - 1);
    const nextIdx = Math.min(trail.length - 1, bestIdx + 1);
    const trailDx = trail[nextIdx].x - trail[prevIdx].x;
    const trailDz = trail[nextIdx].z - trail[prevIdx].z;
    const trailAngle = Math.atan2(-trailDx, -trailDz);

    // Pick the direction along the trail that matches our heading
    const myForwardX = -Math.sin(me.angle);
    const myForwardZ = -Math.cos(me.angle);
    const dot = myForwardX * (-Math.sin(trailAngle)) + myForwardZ * (-Math.cos(trailAngle));
    const alignAngle = dot >= 0 ? trailAngle : trailAngle + Math.PI;

    // Blend: mostly align with trail, slightly curve toward it
    const toTrailDx = trail[bestIdx].x - me.x;
    const toTrailDz = trail[bestIdx].z - me.z;
    const toTrailAngle = Math.atan2(-toTrailDx, -toTrailDz);

    // Weight: 70% trail alignment, 30% approach
    const blendAngle = alignAngle * 0.7 + toTrailAngle * 0.3;
    const angleDiff = ((blendAngle - me.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turnDir = Math.max(-1, Math.min(1, angleDiff * 3));

    // Hold special when close enough to snap
    const special = bestDist < GRIND_SNAP_RANGE * 2.5;

    return { tick, turnDir, accelerate: true, dash: false, brake: false, special };
  }

  private _duringGrind(tick: number, state: SimState, playerIndex: number): InputFrame {
    const me = state.players[playerIndex];
    const grindTicks = tick - this._grindStartTick;

    // Force bail by pushing hard in one direction
    if (this._opts.forceBail) {
      const dir = this._opts.bailSide === 'left' ? -1 : 1;
      return { tick, turnDir: dir, accelerate: false, dash: false, brake: false, special: true };
    }

    // Voluntary dismount after specified duration
    if (this._opts.grindDuration > 0 && grindTicks >= this._opts.grindDuration) {
      return neutralInput(tick); // release special = clean exit
    }

    // Balance correction — immediate full countersteer
    // THPS2 self-reinforcing gravity requires early, aggressive correction.
    // Any nonzero balance gets full input opposing it.
    let turnDir = 0;
    if (Math.abs(me.grindBalance) > 0.01) {
      turnDir = me.grindBalance > 0 ? -1 : 1;
    }

    return { tick, turnDir, accelerate: false, dash: false, brake: false, special: true };
  }

  isDone(tick: number): boolean {
    return tick > this._opts.maxTicks;
  }
}

/**
 * Simple "drive straight and survive" driver for the trail-maker player.
 * Turns gently to avoid walls.
 */
export class TrailMakerDriver implements InputDriver {
  private _maxTicks: number;

  constructor(maxTicks = 1800) {
    this._maxTicks = maxTicks;
  }

  getInput(tick: number, state: SimState, playerIndex: number): InputFrame {
    const me = state.players[playerIndex];
    if (!me || !me.alive) return neutralInput(tick);

    // Simple wall avoidance — turn if near arena edge
    const ARENA_HALF = 192;
    const WALL_MARGIN = 30;
    let turnDir = 0;

    const forwardX = -Math.sin(me.angle);
    const forwardZ = -Math.cos(me.angle);
    const lookAheadX = me.x + forwardX * WALL_MARGIN;
    const lookAheadZ = me.z + forwardZ * WALL_MARGIN;

    if (Math.abs(lookAheadX) > ARENA_HALF - WALL_MARGIN ||
        Math.abs(lookAheadZ) > ARENA_HALF - WALL_MARGIN) {
      // Turn toward center
      const toCenterAngle = Math.atan2(me.x, me.z);
      const diff = ((toCenterAngle - me.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      turnDir = diff > 0 ? 1 : -1;
    }

    return { tick, turnDir, accelerate: true, dash: false, brake: false };
  }

  isDone(tick: number): boolean {
    return tick > this._maxTicks;
  }
}
