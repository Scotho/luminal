import type { InputFrame, SimState } from '../../core/simulation';
import { ARENA_HALF } from '../../core/simulation';
import type { InputDriver } from './types';

const WALL_DANGER_DIST = 25;
const TRAIL_DANGER_DIST = 6;

/**
 * Simple bot that drives forward and turns to avoid walls and trails.
 * Not meant to be smart — just exercises the simulation systems.
 */
export class BotInputDriver implements InputDriver {

  getInput(tick: number, state: SimState, playerIndex: number): InputFrame {
    const p = state.players[playerIndex];
    if (!p || !p.alive) {
      return { tick, turnDir: 0, accelerate: false, dash: false, brake: false };
    }

    let turnDir: -1 | 0 | 1 = 0;

    // Wall avoidance: check distance to each arena edge
    const facingX = Math.sin(p.angle);
    const facingZ = Math.cos(p.angle);

    // Project position forward
    const lookAhead = p.speed * 0.5;
    const futureX = p.x + facingX * lookAhead;
    const futureZ = p.z + facingZ * lookAhead;

    const distToWall = ARENA_HALF - Math.max(Math.abs(futureX), Math.abs(futureZ));

    if (distToWall < WALL_DANGER_DIST) {
      // Turn toward arena center
      const toCenterAngle = Math.atan2(-p.x, -p.z);
      const angleDiff = toCenterAngle - p.angle;
      // Normalize to [-PI, PI]
      const normalized = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      turnDir = normalized > 0 ? 1 : -1;
    }

    // Trail avoidance: check nearby trail segments
    if (turnDir === 0) {
      for (const trail of state.trails) {
        for (let i = trail.length - 1; i > Math.max(0, trail.length - 30); i--) {
          const dx = trail[i].x - futureX;
          const dz = trail[i].z - futureZ;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < TRAIL_DANGER_DIST) {
            // Turn away from trail point
            const awayAngle = Math.atan2(-dx, -dz);
            const angleDiff = awayAngle - p.angle;
            const normalized = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
            turnDir = normalized > 0 ? 1 : -1;
            break;
          }
        }
        if (turnDir !== 0) break;
      }
    }

    return { tick, turnDir, accelerate: false, dash: false, brake: false };
  }

  isDone(_tick: number): boolean {
    return false;
  }
}
