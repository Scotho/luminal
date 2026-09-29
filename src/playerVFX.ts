import * as THREE from 'three';
import { getGfx } from './graphics';
import { hasFiniteTrackPose } from './playerVFXUtil';
import { updateGroundFXImpl } from './playerGroundFX';
import { updateElectricArcsImpl } from './playerArcFX';

// Vehicle builders live in a separate module to keep this file under its
// LOC budget. Re-exported here so existing consumers keep importing from
// './playerVFX' unchanged.
export { buildBike, buildCar, buildHoverboard } from './playerVehicleBuilders';
// ── Pre-warmed death effect resources (avoids shader compile on death frame) ──
export const _deathMat: THREE.PointsMaterial = new THREE.PointsMaterial({
  size: 0.7, transparent: true, opacity: 1, vertexColors: true,
});

// Scratch objects reused across kill() calls to avoid GC pressure on the death frame
export const _killColor: THREE.Color = new THREE.Color();

export interface BikeParts {
  glow: THREE.Mesh;
  bikeLight: THREE.PointLight | null;
  underGlow: THREE.PointLight | null;
  proximityAura: THREE.PointLight | null;
  beam: THREE.SpotLight | null;
  vehicleClone?: THREE.Group;
}

export interface GroundArc {
  line: THREE.Line;
  geo: THREE.BufferGeometry;
  timer: number;
}

export interface GroundFXSystem {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
  lifetimes: Float32Array;
  vels: Float32Array;
  count: number;
  spawnTimer: number;
  groundArcs: GroundArc[];
}

export interface ElectricArc {
  line: THREE.Line;
  geo: THREE.BufferGeometry;
  timer: number;
}

export interface ElectricArcSystem {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
  count: number;
  arcs: ElectricArc[];
  _burstTimer?: number;
}

export interface SpeedLineSystem {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
  velocities: Float32Array;
  count: number;
  active: boolean;
}

// Simulate a full death effect off-screen to force GPU shader compilation + buffer upload.
// Returns a Promise that resolves after the warm-up renders (use as a loading task).
let _shaderWarmed: boolean = false;
export function warmDeathShader(scene: THREE.Scene): Promise<void> {
  if (_shaderWarmed) return Promise.resolve();
  _shaderWarmed = true;

  // Match real death particle count so GPU buffer paths are fully warmed
  const count: number = 20;
  const positions: Float32Array = new Float32Array(count * 3);
  const colors: Float32Array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const i3: number = i * 3;
    positions[i3] = (Math.random() - 0.5) * 2;
    positions[i3 + 1] = -100 + Math.random() * 1.5; // off-screen Y
    positions[i3 + 2] = (Math.random() - 0.5) * 2;
    colors[i3] = 1; colors[i3 + 1] = 0.8; colors[i3 + 2] = 0.5;
  }
  const geo: THREE.BufferGeometry = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat: THREE.PointsMaterial = _deathMat.clone(); // warm the clone path too
  const warmMesh: THREE.Points = new THREE.Points(geo, mat);
  warmMesh.frustumCulled = false; // CRITICAL: render even though off-screen
  scene.add(warmMesh);

  // Wait 3 frames: compile → render → confirm, then clean up
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      scene.remove(warmMesh);
      geo.dispose();
      mat.dispose();
      resolve();
    })));
  });
}

// ── Ground Effect System ─────────────────────────────────
// Small particles that scatter along the ground as the bike moves
export function createGroundFX(scene: THREE.Scene, color: number): GroundFXSystem {
  const count: number = 28;
  const geo: THREE.BufferGeometry = new THREE.BufferGeometry();
  const positions: Float32Array = new Float32Array(count * 3);
  const lifetimes: Float32Array = new Float32Array(count);
  const vels: Float32Array = new Float32Array(count * 2); // vx, vz only
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat: THREE.PointsMaterial = new THREE.PointsMaterial({
    color: color,
    size: 0.3,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points: THREE.Points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Ground lightning arcs — small zaps that crackle along the ground beneath the bike
  const groundArcCount: number = 2;
  const groundArcs: GroundArc[] = [];
  const groundArcMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < groundArcCount; i++) {
    const arcGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
    const arcPos: Float32Array = new Float32Array(5 * 3); // 5-point zigzag
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    const line: THREE.Line = new THREE.Line(arcGeo, groundArcMat.clone());
    line.frustumCulled = false;
    scene.add(line);
    groundArcs.push({ line, geo: arcGeo, timer: Math.random() * 0.1 });
  }

  return { points, geo, mat, lifetimes, vels, count, spawnTimer: 0, groundArcs };
}

export function updateGroundFX(gfx: GroundFXSystem, bikePos: THREE.Vector3, bikeAngle: number, speed: number, wBoosting: boolean, dashing: boolean, dashJustPressed: boolean, dt: number): void {
  updateGroundFXImpl(gfx, bikePos, bikeAngle, speed, wBoosting, dashing, dashJustPressed, dt);
}

// ── Electric Arc System (boost/dash) ─────────────────────
// Particles that jitter around the bike like static electricity
export function createElectricArcs(scene: THREE.Scene, color: number): ElectricArcSystem {
  const count: number = 22;
  const geo: THREE.BufferGeometry = new THREE.BufferGeometry();
  const positions: Float32Array = new Float32Array(count * 3);
  const colors: Float32Array = new Float32Array(count * 3);
  const baseColor: THREE.Color = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const i3: number = i * 3;
    colors[i3] = 0.7 + baseColor.r * 0.3;
    colors[i3 + 1] = 0.8 + baseColor.g * 0.2;
    colors[i3 + 2] = 1.0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat: THREE.PointsMaterial = new THREE.PointsMaterial({
    size: 0.2,
    transparent: true,
    opacity: 0,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points: THREE.Points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Arc lines — short electric zaps
  const arcCount: number = 6;
  const arcs: ElectricArc[] = [];
  const arcMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < arcCount; i++) {
    const arcGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
    const arcPos: Float32Array = new Float32Array(4 * 3); // 4-point zigzag
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    const line: THREE.Line = new THREE.Line(arcGeo, arcMat.clone());
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({ line, geo: arcGeo, timer: Math.random() * 0.2 });
  }

  return { points, geo, mat, count, arcs };
}

export function updateElectricArcs(ea: ElectricArcSystem, bikePos: THREE.Vector3, bikeAngle: number, active: boolean, dashJustPressed: boolean, dt: number): void {
  updateElectricArcsImpl(ea, bikePos, bikeAngle, active, dashJustPressed, dt);
}

// Speed line depth tiers — near particles are faster, far are slower
const SL_TIER_NEAR = 12;
const SL_TIER_MID = 16;
const SL_TIERS = [
  { speedMul: 1.3, minAhead: 1, maxAhead: 3, respawnDistSq: 100 },
  { speedMul: 1.0, minAhead: 3, maxAhead: 6, respawnDistSq: 225 },
  { speedMul: 0.7, minAhead: 6, maxAhead: 9, respawnDistSq: 400 },
];
function slTier(i: number): number {
  return i < SL_TIER_NEAR ? 0 : i < SL_TIER_NEAR + SL_TIER_MID ? 1 : 2;
}

// ── Dash Speed Lines Particle System ──────────────────────
export function createSpeedLines(scene: THREE.Scene, color: number): SpeedLineSystem {
  const count: number = 40;
  const geo: THREE.BufferGeometry = new THREE.BufferGeometry();
  const positions: Float32Array = new Float32Array(count * 3);
  const velocities: Float32Array = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat: THREE.PointsMaterial = new THREE.PointsMaterial({
    color: color,
    size: 0.15,
    transparent: true,
    opacity: 0,
  });
  const points: THREE.Points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return { points, geo, mat, velocities, count, active: false };
}

export function updateSpeedLines(
  sl: SpeedLineSystem, playerPos: THREE.Vector3, playerAngle: number,
  dashing: boolean, dashJustPressed: boolean, dt: number,
  grinding = false, grindBalance = 0,
): void {
  if (!hasFiniteTrackPose(playerPos, playerAngle)) {
    sl.mat.opacity = 0;
    sl.active = false;
    return;
  }
  const positions = sl.geo.attributes.position.array as Float32Array;
  // Grind intensity: boost opacity when grinding
  const grindMul = grinding ? (dashing ? 2.0 : 1.5) : 1.0;
  const activeForGrind = dashing || grinding;
  const baseOpacity: number = activeForGrind ? 0.6 : 0;
  const targetOpacity: number = baseOpacity * grindMul;
  sl.mat.opacity += (targetOpacity - sl.mat.opacity) * 4 * dt;
  // Danger tint: shift toward red when in grind danger zone
  if (grinding && Math.abs(grindBalance) >= 0.7) {
    sl.mat.color.setHex(0xff4444);
  } else if (grinding) {
    sl.mat.color.setHex(0x00d4ff);
  }

  // Retrigger burst on every dash re-press
  if (dashJustPressed && dashing) sl.active = false;

  if (activeForGrind && !sl.active) {
    // Spawn particles around player
    for (let i = 0; i < sl.count; i++) {
      const i3: number = i * 3;
      const tier = SL_TIERS[slTier(i)];
      const side: number = (Math.random() - 0.5) * 4;
      const ahead: number = Math.random() * (tier.maxAhead - tier.minAhead) + tier.minAhead;
      const fx: number = -Math.sin(playerAngle);
      const fz: number = -Math.cos(playerAngle);
      const rx: number = Math.cos(playerAngle);
      const rz: number = -Math.sin(playerAngle);
      positions[i3] = playerPos.x + fx * ahead + rx * side;
      positions[i3 + 1] = 0.5 + Math.random() * 2.5;
      positions[i3 + 2] = playerPos.z + fz * ahead + rz * side;
      sl.velocities[i] = (15 + Math.random() * 25) * tier.speedMul;
    }
    sl.active = true;
  }

  if (sl.active) {
    const bx: number = Math.sin(playerAngle);
    const bz: number = Math.cos(playerAngle);
    for (let i = 0; i < sl.count; i++) {
      const i3: number = i * 3;
      // Move particles backward past the player
      positions[i3] += bx * sl.velocities[i] * dt;
      positions[i3 + 2] += bz * sl.velocities[i] * dt;

      // Respawn if too far behind
      const dx: number = positions[i3] - playerPos.x;
      const dz: number = positions[i3 + 2] - playerPos.z;
      const distSq: number = dx * dx + dz * dz;
      if (distSq > SL_TIERS[slTier(i)].respawnDistSq || !activeForGrind) {
        if (activeForGrind) {
          const tier = SL_TIERS[slTier(i)];
          const side: number = (Math.random() - 0.5) * 4;
          const ahead: number = Math.random() * (tier.maxAhead - tier.minAhead) + tier.minAhead;
          const fx: number = -Math.sin(playerAngle);
          const fz: number = -Math.cos(playerAngle);
          const rx: number = Math.cos(playerAngle);
          const rz: number = -Math.sin(playerAngle);
          positions[i3] = playerPos.x + fx * ahead + rx * side;
          positions[i3 + 1] = 0.5 + Math.random() * 2.5;
          positions[i3 + 2] = playerPos.z + fz * ahead + rz * side;
          sl.velocities[i] = (15 + Math.random() * 25) * tier.speedMul;
        }
      }
    }
    sl.geo.attributes.position.needsUpdate = true;

    if (!activeForGrind && sl.mat.opacity < 0.02) {
      sl.active = false;
    }
  }
}

// ── Snap Exit Smoke Burst ─────────────────────────────────
export interface SnapSmokeFX {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
  lifetimes: Float32Array;
  maxLifetimes: Float32Array;
  vxArr: Float32Array;
  vyArr: Float32Array;
  vzArr: Float32Array;
  count: number;
  active: boolean;
}

export function createSnapSmoke(scene: THREE.Scene, color: number): SnapSmokeFX {
  const vfx = getGfx().playerVFX;
  const count = vfx === 'reduced' ? 10 : 20;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count * 3; i++) positions[i] = -9999;
  for (let i = 0; i < count; i++) sizes[i] = 0.6;
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Desaturated player color — lerp toward white then darken for smoke look
  const c = new THREE.Color(color);
  c.lerp(new THREE.Color(0xffffff), 0.6);
  c.multiplyScalar(0.8);

  const mat = new THREE.PointsMaterial({
    color: c,
    size: 0.6,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  return {
    points, geo, mat,
    lifetimes: new Float32Array(count),
    maxLifetimes: new Float32Array(count),
    vxArr: new Float32Array(count),
    vyArr: new Float32Array(count),
    vzArr: new Float32Array(count),
    count, active: false,
  };
}

export function triggerSnapSmoke(smoke: SnapSmokeFX, pos: THREE.Vector3, oldVelocityAngle: number): void {
  if (!hasFiniteTrackPose(pos, oldVelocityAngle)) return;
  const positions = smoke.geo.attributes.position.array as Float32Array;
  // Spawn behind car along old slide direction (where wheels were skidding)
  const slideX = Math.sin(oldVelocityAngle);
  const slideZ = Math.cos(oldVelocityAngle);
  // Lateral perpendicular to slide
  const latX = Math.cos(oldVelocityAngle);
  const latZ = -Math.sin(oldVelocityAngle);

  for (let i = 0; i < smoke.count; i++) {
    const i3 = i * 3;
    const behind = 2.0 + (i / smoke.count) * 2.0; // 2-4 units behind
    const lateral = ((i % 5) / 4 - 0.5) * 3.0; // spread ±1.5 units
    positions[i3]     = pos.x + slideX * behind + latX * lateral;
    positions[i3 + 1] = 0.2 + (i % 3) * 0.15;
    positions[i3 + 2] = pos.z + slideZ * behind + latZ * lateral;

    // Outward velocity — puff up and sideways
    smoke.vxArr[i] = (Math.sin(i * 2.7 + 0.3) * 0.5 + 0.5) * 2.0 * (i % 2 === 0 ? 1 : -1) * latX + slideX * 0.5;
    smoke.vzArr[i] = (Math.sin(i * 2.7 + 0.3) * 0.5 + 0.5) * 2.0 * (i % 2 === 0 ? 1 : -1) * latZ + slideZ * 0.5;
    smoke.vyArr[i] = 1.0 + (i % 7) * 0.3; // upward

    const life = 0.3 + (i % 4) * 0.1; // 0.3-0.6s deterministic from index
    smoke.maxLifetimes[i] = life;
    smoke.lifetimes[i] = life;
  }
  smoke.mat.opacity = 0.5;
  smoke.active = true;
  smoke.geo.attributes.position.needsUpdate = true;
}

export function updateSnapSmoke(smoke: SnapSmokeFX, dt: number): void {
  if (!smoke.active) return;
  const positions = smoke.geo.attributes.position.array as Float32Array;
  let allDead = true;

  for (let i = 0; i < smoke.count; i++) {
    if (smoke.lifetimes[i] <= 0) continue;
    allDead = false;
    smoke.lifetimes[i] -= dt;
    const i3 = i * 3;

    // Move with drag
    positions[i3]     += smoke.vxArr[i] * dt;
    positions[i3 + 1] += smoke.vyArr[i] * dt;
    positions[i3 + 2] += smoke.vzArr[i] * dt;
    smoke.vxArr[i] *= 0.97;
    smoke.vzArr[i] *= 0.97;
    smoke.vyArr[i] *= 0.94;
  }

  // Global opacity fade based on oldest remaining particle
  let maxRemaining = 0;
  for (let i = 0; i < smoke.count; i++) {
    if (smoke.lifetimes[i] > maxRemaining) maxRemaining = smoke.lifetimes[i];
  }
  smoke.mat.opacity = Math.min(0.5, maxRemaining * 1.5);
  smoke.mat.size = 0.6 + (1 - maxRemaining / 0.6) * 0.6; // grow 0.6 → 1.2

  smoke.geo.attributes.position.needsUpdate = true;

  if (allDead) {
    smoke.active = false;
    smoke.mat.opacity = 0;
    // Move offscreen
    for (let i = 0; i < smoke.count * 3; i++) positions[i] = -9999;
    smoke.geo.attributes.position.needsUpdate = true;
  }
}
