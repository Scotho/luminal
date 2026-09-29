// ── Grind state machine (extracted from simulation.ts) ──
// Deterministic lockstep — bit-identical math must match simulation.ts semantics.
// Handles three post-grind states: recovery, airborne, and active grinding.
// Mutates player state in place — no allocations.

import type { VehiclePhysics } from '../vehicleConfig';
import { detectTrick } from './trickDetection';
import {
  _findNearestTrailSeg,
  GRIND_AIRBORNE_BAIL,
  GRIND_AIRBORNE_CLEAN,
  GRIND_ALIGN_BLEND,
  GRIND_BAIL_LATERAL_SPEED,
  GRIND_BAIL_METER_PENALTY,
  GRIND_BAIL_SPEED_MULT,
  GRIND_COOLDOWN,
  GRIND_DANGER_CORRECT_PENALTY,
  GRIND_DANGER_ZONE,
  GRIND_DASH_INSTABILITY_MULT,
  GRIND_DASH_SPEED_BONUS,
  GRIND_DISRUPT_RANGE,
  GRIND_HOP_BALANCE_PERTURB,
  GRIND_HOP_RANGE,
  GRIND_INSTABILITY_BASE,
  GRIND_INSTABILITY_CAP,
  GRIND_INSTABILITY_RATE,
  GRIND_JUMP_HEIGHT_BAIL,
  GRIND_JUMP_HEIGHT_CLEAN,
  GRIND_LEAN_ACC,
  GRIND_LEAN_GRAVITY,
  GRIND_LEAN_RND_KICK,
  GRIND_LEAN_RND_RANGE,
  GRIND_METER_REGEN_BASE,
  GRIND_METER_REGEN_PERFECT,
  GRIND_RECOVERY_BAIL,
  GRIND_RECOVERY_CLEAN,
  GRIND_SPEED_BONUS,
  GRIND_SWEET_SPEED_BONUS,
  GRIND_SCORE_BASE_PER_SEGMENT,
  GRIND_SCORE_DASH_MULT,
  GRIND_SCORE_SWEET_MULT,
  GRIND_SCORE_MULT_CAP,
  GRIND_SCORE_MILESTONE_MULT_ADD,
  GRIND_SCORE_TRICK_MULT_ADD,
  GRIND_CHAIN_MAX_LENGTH,
  GRIND_SWEET_SPOT,
  GRIND_TRAIL_MODS,
  mulberry32,
  STREAK_MILESTONES,
} from './simulation';
import type { InputFrame, PlayerSim, SimState } from './simulation';

// Meter constants (match player.ts)
const METER_MAX = 100;

// ── Grind exit (clean dismount or bail) ─────────────────

export function _exitGrind(p: PlayerSim, bail: boolean): void {
  // Track best streak before resetting
  p.grindStreakBest = Math.max(p.grindStreakBest, p.grindStreakCount);
  p.grindStreakCount = 0;

  if (bail) {
    // ── Snapshot for BUSTED overlay, then reset (SPEC-82) ──
    p.grindBustScore = Math.round(p.grindScore);
    p.grindScore = 0;
    p.grindMultiplier = 1.0;
    p.grindChain.length = 0;
    p.grindChainDirty++;
    p.grindRunActive = false;
  }

  // Eject toward whichever side balance overflowed. At exactly 0 (impossible in
  // practice due to self-reinforcing gravity), default to +1.
  p.grindBailSide = bail ? (p.grindBalance >= 0 ? 1 : -1) : 0;
  p.grinding = false;
  p.airborne = true;
  p.landingPenalty = bail;
  if (bail) {
    p.airborneTimer = GRIND_AIRBORNE_BAIL;
    p.airborneDuration = GRIND_AIRBORNE_BAIL;
    p.airbornePeak = GRIND_JUMP_HEIGHT_BAIL;
    p.speed *= GRIND_BAIL_SPEED_MULT;
    p.meter = Math.max(0, p.meter - GRIND_BAIL_METER_PENALTY);
  } else {
    p.airborneTimer = GRIND_AIRBORNE_CLEAN;
    p.airborneDuration = GRIND_AIRBORNE_CLEAN;
    p.airbornePeak = GRIND_JUMP_HEIGHT_CLEAN;
  }
  p.grindTrailOwner = -1;
  p.grindSegIdx = 0;
  p.grindSegT = 0;
  p.grindBalance = 0;
  p.grindLeanDir = 0;
  p.grindRngState = 0;
  p.grindSpeed = 0;
  p.grindDirection = 1;
  p.grindDuration = 0;
  p.grindGraceTimer = 0;
  p.grindOwnTrail = false;
  p.grindTrailVehicleType = null;
  // Reset trick state for new airborne phase
  p.trickInputBuffer = [];
  p.trickDetected = '';
  p.trickMeterBonus = 0;
  p.trickSampleTimer = 0;
}

// ── Grind advance (balance minigame + trail movement) ───
// Handles three post-grind states: recovery, airborne, and active grinding.
// Mutates player state in place — no allocations.

export function advanceGrind(
  p: PlayerSim,
  input: InputFrame,
  cfg: VehiclePhysics,
  dt: number,
  state: SimState,
  playerIndex: number,
): void {
  // NOTE: grindCooldown is ticked by advancePlayer() before routing here.
  // Do NOT tick it again — that would cause a double-tick bug.

  // ── Recovery phase ─────────────────────────────────────
  if (p.recovery) {
    p.recoveryTimer -= dt;
    if (p.recoveryTimer <= 0) {
      p.recovery = false;
      p.grindCooldown = GRIND_COOLDOWN;
    }
    if (p.landingPenalty) {
      p.speed += (cfg.brakeSpeed - p.speed) * Math.min(1, 4 * dt);
    }
    // Sluggish steering (50% turnSpeed)
    const target = input.turnDir;
    if (target !== 0) {
      p.turnRamp += (target - p.turnRamp) * Math.min(1, cfg.turnLerp * dt);
    } else {
      p.turnRamp *= Math.exp(-cfg.turnDecay * dt);
      if (Math.abs(p.turnRamp) < 0.01) p.turnRamp = 0;
    }
    p.angle += (p.turnRamp + p.courseAssist) * cfg.turnSpeed * 0.5 * dt;
    p.x += -Math.sin(p.angle) * p.speed * dt;
    p.z += -Math.cos(p.angle) * p.speed * dt;
    p.trailTimer++;
    return;
  }

  // ── Airborne phase (SSX-inspired) ─────────────────────
  if (p.airborne) {
    // ── Trick input sampling ──────────────────────────────
    p.trickSampleTimer++;
    if (p.trickSampleTimer % 4 === 0 && input.turnDir !== 0) {
      p.trickInputBuffer.push(Math.sign(input.turnDir));
      if (p.trickInputBuffer.length > 6) p.trickInputBuffer.shift();
      if (p.trickDetected === '') {
        const trick = detectTrick(p.trickInputBuffer);
        if (trick) {
          p.trickDetected = trick.name;
          p.trickMeterBonus = trick.meterBonus;
        }
      }
    }

    p.airborneTimer -= dt;
    if (p.airborneTimer <= 0) {
      p.airborne = false;
      p.recovery = true;
      p.recoveryTimer = p.landingPenalty ? GRIND_RECOVERY_BAIL : GRIND_RECOVERY_CLEAN;
      p.trailTimer = 0; // Reset so recovery doesn't lay stale trail point
      p.grindBailSide = 0; // Clear bail side on landing
      // Apply trick meter bonus on landing
      p.meter = Math.min(METER_MAX, p.meter + p.trickMeterBonus);
      // ── Chain push + multiplier growth on trick landing (SPEC-82) ──
      if (p.grindRunActive && p.trickDetected !== '') {
        // Shift before push so grindChain.length is never > GRIND_CHAIN_MAX_LENGTH
        if (p.grindChain.length >= GRIND_CHAIN_MAX_LENGTH) {
          p.grindChain.shift();
        }
        p.grindChain.push(p.trickDetected);
        p.grindMultiplier = Math.min(
          GRIND_SCORE_MULT_CAP,
          p.grindMultiplier + GRIND_SCORE_TRICK_MULT_ADD,
        );
        p.grindChainDirty++;
      }
      // Reset trick state
      p.trickInputBuffer = [];
      p.trickDetected = '';
      p.trickMeterBonus = 0;
      p.trickSampleTimer = 0;
    }
    // Free rotation — full turnSpeed
    p.angle += input.turnDir * cfg.turnSpeed * dt;
    // Speed preserved — no friction
    p.x += -Math.sin(p.angle) * p.speed * dt;
    p.z += -Math.cos(p.angle) * p.speed * dt;
    // Lateral push on bail — eject sideways in direction of failed balance
    if (p.landingPenalty && p.grindBailSide !== 0) {
      const lateralAngle = p.angle + (Math.PI / 2) * p.grindBailSide;
      p.x += -Math.sin(lateralAngle) * GRIND_BAIL_LATERAL_SPEED * dt;
      p.z += -Math.cos(lateralAngle) * GRIND_BAIL_LATERAL_SPEED * dt;
    }
    // No trail laid, no trailTimer increment
    return;
  }

  // ── Active grinding (THPS2-style balance) ──────────────
  if (p.grinding) {
    p.grindDuration += dt;

    // Tick grace timer — balance minigame held off while > 0
    const inGrace = p.grindGraceTimer > 0;
    if (inGrace) {
      p.grindGraceTimer = Math.max(0, p.grindGraceTimer - dt);
    }

    // Trail type modifiers — own-trail grinding is always neutral
    const trailMods = p.grindOwnTrail
      ? GRIND_TRAIL_MODS.hoverboard
      : GRIND_TRAIL_MODS[state.players[p.grindTrailOwner].vehicleType];

    if (!inGrace) {
      // Instability ramps with duration (THPS2: Instable_base + mManualTime * Instable_Rate)
      const instability = Math.min(
        GRIND_INSTABILITY_CAP,
        GRIND_INSTABILITY_BASE + p.grindDuration * GRIND_INSTABILITY_RATE,
      );
      const dashMult = input.dash ? GRIND_DASH_INSTABILITY_MULT : 1.0;
      const effectiveInstability = instability * dashMult * trailMods.instabilityMult;

      // 1. Self-reinforcing gravity — the THPS2 "tipping point"
      //    Further from center = faster acceleration outward
      p.grindBalance += p.grindBalance * GRIND_LEAN_GRAVITY * effectiveInstability * dt;

      // 2. Lean velocity applied (also scaled by instability)
      p.grindBalance += p.grindLeanDir * effectiveInstability * dt;

      // 3. Continuous random perturbation via seeded RNG (every tick)
      //    THPS2: always pushes in the direction of current lean velocity,
      //    creating a runaway effect that makes recovery progressively harder.
      const r1 = mulberry32(p.grindRngState);
      p.grindRngState = r1.next;
      const perturbMag = r1.value * GRIND_LEAN_RND_RANGE; // always positive [0, 0.5)
      const leanSign = p.grindLeanDir >= 0 ? 1 : -1;
      p.grindLeanDir += perturbMag * leanSign;
      // If lean velocity stalls, kick it with a random direction
      if (Math.abs(p.grindLeanDir) < 0.05) {
        const r2 = mulberry32(p.grindRngState);
        p.grindRngState = r2.next;
        const kickDir = r2.value < 0.5 ? -1 : 1;
        p.grindLeanDir = GRIND_LEAN_RND_KICK * kickDir;
      }

      // 4. Player correction (continuous analog input)
      const absBal = Math.abs(p.grindBalance);
      const correctMult = absBal >= GRIND_DANGER_ZONE ? GRIND_DANGER_CORRECT_PENALTY : 1.0;
      p.grindBalance += input.turnDir * GRIND_LEAN_ACC * correctMult * dt;

      // 5. Opponent proximity disruption (unchanged)
      let disruptForce = 0;
      for (let i = 0; i < state.players.length; i++) {
        if (i === playerIndex) continue;
        const other = state.players[i];
        if (!other.alive) continue;
        const dx = other.x - p.x;
        const dz = other.z - p.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < GRIND_DISRUPT_RANGE && dist > 0.1) {
          const grindAngle = p.angle;
          const toOpponent = Math.atan2(-dx, -dz);
          const relAngle = toOpponent - grindAngle;
          const side = Math.sin(relAngle) > 0 ? 1 : -1;
          const strength = (1 - dist / GRIND_DISRUPT_RANGE) * 0.8;
          disruptForce += side * strength;
        }
      }
      p.grindBalance += disruptForce * dt;
    }

    // Check bail
    if (Math.abs(p.grindBalance) >= 1.0) {
      _exitGrind(p, true);
      return;
    }

    // Determine zone
    const absBalNow = Math.abs(p.grindBalance);
    const zone: 'sweet' | 'normal' | 'danger' =
      absBalNow < GRIND_SWEET_SPOT ? 'sweet'
      : absBalNow < GRIND_DANGER_ZONE ? 'normal' : 'danger';

    // Speed
    let grindSpeedNow = p.grindSpeed;
    if (zone === 'sweet') grindSpeedNow += GRIND_SWEET_SPEED_BONUS;
    if (zone === 'danger') grindSpeedNow = p.grindSpeed - GRIND_SPEED_BONUS;
    if (input.dash && p.meter > 0) {
      grindSpeedNow += GRIND_DASH_SPEED_BONUS;
      grindSpeedNow = Math.min(grindSpeedNow, cfg.dashSpeed);
    }
    p.speed = grindSpeedNow;

    // Meter regen (enemy trail only, modified by trail type)
    if (!p.grindOwnTrail) {
      let regen = 0;
      if (zone === 'sweet') regen = GRIND_METER_REGEN_PERFECT * trailMods.regenMult;
      else if (zone === 'normal') regen = GRIND_METER_REGEN_BASE * trailMods.regenMult;
      if (input.dash) regen -= cfg.dashDrain;
      p.meter = Math.max(0, Math.min(METER_MAX, p.meter + regen * dt));
      if (p.boostLocked && p.meter >= METER_MAX * cfg.boostLockThreshold) {
        p.boostLocked = false;
      }
    }
    if (p.grindOwnTrail && input.dash) {
      p.meter = Math.max(0, p.meter - cfg.dashDrain * dt);
    }

    // Advance along trail
    const trail = state.trails[p.grindTrailOwner];
    if (!trail || trail.length < 2) {
      _exitGrind(p, false);
      return;
    }

    const nextSegOffset = p.grindDirection > 0 ? 1 : -1;
    const segA = trail[p.grindSegIdx];
    const segB = trail[p.grindSegIdx + nextSegOffset];
    if (!segA || !segB) {
      _exitGrind(p, false);
      return;
    }

    const segDx = segB.x - segA.x;
    const segDz = segB.z - segA.z;
    const segLen = Math.sqrt(segDx * segDx + segDz * segDz);
    if (segLen < 0.001) {
      p.grindSegIdx += p.grindDirection;
      p.grindSegT = 0;
    } else {
      p.grindSegT += (p.speed / segLen) * dt;
    }

    // Advance segments
    while (p.grindSegT >= 1.0) {
      p.grindSegT -= 1.0;
      const prevIdx = p.grindSegIdx;
      p.grindSegIdx += p.grindDirection;

      // Check end of trail
      if (p.grindSegIdx >= trail.length - 1 || p.grindSegIdx <= 0) {
        _exitGrind(p, false);
        return;
      }

      // ── Streak tracking ──
      if (absBalNow < GRIND_DANGER_ZONE) {
        p.grindStreakBroken = false;
        p.grindStreakCount++;
        // Check milestone bonuses (enemy trail only — own-trail is no-benefit)
        if (!p.grindOwnTrail) {
          for (let mi = 0; mi < STREAK_MILESTONES.length; mi++) {
            if (p.grindStreakCount === STREAK_MILESTONES[mi][0]) {
              // ── Milestone multiplier growth (SPEC-82) ────────────
              p.grindMultiplier = Math.min(
                GRIND_SCORE_MULT_CAP,
                p.grindMultiplier + GRIND_SCORE_MILESTONE_MULT_ADD,
              );
              // Milestone signal — bumps dirty without appending to grindChain (score event, not a trick name)
              p.grindChainDirty++;
              p.meter = Math.min(METER_MAX, p.meter + STREAK_MILESTONES[mi][1]);
              break;
            }
          }
          // ── Score accumulation (SPEC-82) ──────────────────────
          const zoneFactor = absBalNow < GRIND_SWEET_SPOT ? GRIND_SCORE_SWEET_MULT : 1.0;
          const dashFactor = input.dash ? GRIND_SCORE_DASH_MULT : 1.0;
          p.grindScore += GRIND_SCORE_BASE_PER_SEGMENT * p.grindMultiplier * zoneFactor * dashFactor;
        }
      } else {
        p.grindStreakCount = 0;
        p.grindStreakBroken = true;
      }

      // Queue previous segment for destruction (enemy trail only)
      if (!p.grindOwnTrail) {
        p._grindDestroyQueue.push(prevIdx);
      }
    }

    // Snap position to rail
    const curA = trail[p.grindSegIdx];
    const nextIdx = p.grindSegIdx + nextSegOffset;
    const curB = trail[nextIdx] ?? curA;
    p.x = curA.x + (curB.x - curA.x) * p.grindSegT;
    p.z = curA.z + (curB.z - curA.z) * p.grindSegT;

    // Align angle to segment direction
    const targetAngle = Math.atan2(-(curB.x - curA.x), -(curB.z - curA.z));
    const angleDiff = ((targetAngle - p.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    p.angle += angleDiff * Math.min(1, (1 / GRIND_ALIGN_BLEND) * dt);

    // Dismount check — Space released
    if (!input.special) {
      _exitGrind(p, false);
      return;
    }

    // Trail hop — check if closer enemy trail in range
    if (input.special) {
      const hop = _findNearestTrailSeg(p.x, p.z, playerIndex, state, GRIND_HOP_RANGE);
      if (hop && hop.trailOwner !== p.grindTrailOwner && hop.dist < GRIND_HOP_RANGE) {
        p.grindTrailOwner = hop.trailOwner;
        p.grindSegIdx = hop.segIdx;
        p.grindSegT = 0;
        p.grindOwnTrail = hop.isOwn;
        p.grindTrailVehicleType = state.players[hop.trailOwner].vehicleType;
        // Recalculate grind speed with new trail type modifier
        const hopMods = hop.isOwn
          ? GRIND_TRAIL_MODS.hoverboard
          : GRIND_TRAIL_MODS[state.players[hop.trailOwner].vehicleType];
        p.grindSpeed = p.speed + GRIND_SPEED_BONUS * hopMods.speedMult;
        const r = mulberry32(p.grindRngState);
        p.grindRngState = r.next;
        p.grindBalance += (r.value - 0.5) * 2 * GRIND_HOP_BALANCE_PERTURB;
        p.grindBalance = Math.max(-0.99, Math.min(0.99, p.grindBalance));
        const hopTrail = state.trails[hop.trailOwner];
        const seg = hopTrail[hop.segIdx];
        const segNext = hopTrail[hop.segIdx + 1] ?? hopTrail[hop.segIdx - 1];
        if (seg && segNext) {
          const sDx = segNext.x - seg.x;
          const sDz = segNext.z - seg.z;
          const velX = -Math.sin(p.angle);
          const velZ = -Math.cos(p.angle);
          const dot = velX * sDx + velZ * sDz;
          p.grindDirection = dot >= 0 ? 1 : -1;
        }
      }
    }

    return;
  }
}
