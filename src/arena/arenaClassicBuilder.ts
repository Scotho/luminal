import * as THREE from 'three';
import type { GfxSettings, MapType } from '../types/index';
import { setArenaShape } from '../core/simulation';
import type { ReactiveState } from './arenaState';
import { setGridArenaShape } from './arenaShape';
import { ARENA_ORANGE_DEEP, ARENA_TEAL_BRIGHT } from './arenaTheme';
import { buildArenaGrids, buildFloorReflector, loadNebulaSkybox } from './arenaSharedPieces';
import { enableReflection } from '../renderLayers';

export interface ArenaClassicBuildResult {
  portholeR: number;
  roofY: number;
}

let _cachedHullTex: THREE.CanvasTexture | null = null;

interface ClassicGeometry {
  corners: [number, number][];
  edgePts: [number, number][];
  barrierH: number;
}

const BARRIER_H = 12;
// Play area half-size — walls, floor, grid, and kill boundary all
// share this value so everything sits flush.
const PLAY_HALF = 170;
const PLAY_SIZE = PLAY_HALF * 2;
const STADIUM_OFFSET = 30;
const TIER_COUNT = 6;
const TIER_HEIGHT = 8;
const TIER_DEPTH = 10.5;

/** Entry point for the classic procedural arena. */
export function buildArenaClassic(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  mapType: MapType,
  cachedWallTexture: THREE.CanvasTexture,
): ArenaClassicBuildResult {
  setGridArenaShape(false, PLAY_HALF);
  setArenaShape(false, PLAY_HALF);

  cachedWallTexture.repeat.set(2, 1);

  // ── Planar floor reflector (classic — matches tighter play area) ──
  buildFloorReflector(scene, reactive, gfx, mapType, new THREE.PlaneGeometry(PLAY_SIZE, PLAY_SIZE));

  buildClassicFloorGlow(scene, gfx);

  // ── Grid lines (classic — transparent over reflector) ──
  buildArenaGrids(scene, reactive, gfx, PLAY_SIZE, false);

  // ── GLB skybox (same as V2) ──────────────────────────────
  loadNebulaSkybox(scene, reactive);

  const geom: ClassicGeometry = {
    corners: [[-PLAY_HALF, -PLAY_HALF], [PLAY_HALF, -PLAY_HALF], [PLAY_HALF, PLAY_HALF], [-PLAY_HALF, PLAY_HALF]],
    edgePts: [],
    barrierH: BARRIER_H,
  };
  geom.edgePts = [...geom.corners, geom.corners[0]];

  // ── Arena Barrier Walls (square, 4 flat panels) ─────────
  buildClassicBarrierWalls(scene, reactive, cachedWallTexture, geom, PLAY_SIZE);
  for (const b of reactive.barriers) enableReflection(b);

  // Emissive orange baseboard strips (bottom + top edge of each wall)
  const baseStripMat = buildClassicBaseStrips(scene, reactive, PLAY_SIZE);

  buildClassicEdgeLines(scene, geom);
  buildClassicWallLights(scene, gfx, geom);
  buildClassicStadiumFloor(scene, geom);

  const standBase: number = PLAY_HALF + STADIUM_OFFSET;
  const totalStandHeight: number = TIER_COUNT * TIER_HEIGHT;

  // ── Stadium Structure ────────────────────────────────
  buildClassicStands(scene, reactive, gfx, PLAY_SIZE, standBase);
  for (const ts of reactive.tierStrips) enableReflection(ts.mesh);

  const ringRadius: number = PLAY_HALF + STADIUM_OFFSET + TIER_COUNT * TIER_DEPTH / 2;
  const ringY: number = totalStandHeight + 15;

  const outerWallR: number = ringRadius * 1.08;
  const outerWallH: number = ringY + 15;

  // ── Outer hull cylinder + accent rings + top rim ────────
  const rimTopY = buildClassicOuterHull(scene, reactive, gfx, outerWallR, outerWallH, baseStripMat);

  reactive._outerWallR = outerWallR;
  reactive._rimTopY = rimTopY;

  // ── Ambient Stadium Lights ───────────────────────────
  buildClassicStadiumLights(scene, reactive, gfx, standBase, totalStandHeight);

  // ── Rave Spotlights ──────────────────────────────────
  buildClassicRaveSpots(scene, reactive, gfx, standBase, totalStandHeight);

  return {
    portholeR: outerWallR,
    roofY: rimTopY,
  };
}

/** Decorative ambient floor glows (point lights) at the arena center. */
function buildClassicFloorGlow(scene: THREE.Scene, gfx: GfxSettings): void {
  if (gfx.arenaDetail === 'minimal') return;
  const floorGlow = new THREE.PointLight(0xFC741E, 1.0, 90);
  floorGlow.position.set(0, 0.3, 0);
  scene.add(floorGlow);
  const floorGlow2 = new THREE.PointLight(0x184D51, 0.8, 100);
  floorGlow2.position.set(40, 0.3, -30);
  scene.add(floorGlow2);
}

/** Four flat barrier walls with shooting-star texture + backing panels. */
function buildClassicBarrierWalls(
  scene: THREE.Scene,
  reactive: ReactiveState,
  cachedWallTexture: THREE.CanvasTexture,
  geom: ClassicGeometry,
  gridSize: number,
): void {
  const wallPanelMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
    map: cachedWallTexture,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const halfWall = gridSize / 2;
  const wallGeo: THREE.PlaneGeometry = new THREE.PlaneGeometry(gridSize, geom.barrierH);
  const wallDefs: Array<{ pos: [number, number, number]; rot: [number, number, number] }> = [
    { pos: [0, geom.barrierH / 2, -halfWall], rot: [0, 0, 0] },
    { pos: [0, geom.barrierH / 2, halfWall], rot: [0, Math.PI, 0] },
    { pos: [-halfWall, geom.barrierH / 2, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [halfWall, geom.barrierH / 2, 0], rot: [0, -Math.PI / 2, 0] },
  ];
  const backingMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
    color: 0x020305,
    side: THREE.DoubleSide,
  });
  const backingOffset: number = 0.3;

  wallDefs.forEach(({ pos, rot }) => {
    const wall: THREE.Mesh = new THREE.Mesh(wallGeo, wallPanelMat);
    wall.position.set(...pos);
    wall.rotation.set(...rot);
    wall.renderOrder = 15;  // draw in front of outer hull cylinder
    scene.add(wall);
    reactive.barriers.push(wall);

    const backing: THREE.Mesh = new THREE.Mesh(wallGeo, backingMat);
    const dir: THREE.Vector3 = new THREE.Vector3(...pos).normalize();
    backing.position.set(
      pos[0] + dir.x * backingOffset,
      pos[1],
      pos[2] + dir.z * backingOffset
    );
    backing.rotation.set(...rot);
    backing.renderOrder = 14;  // behind the shooting star wall, in front of outer hull
    scene.add(backing);
  });
}

/** Emissive orange base strips at the bottom of each wall, returns the
 *  shared material so the outer-hull top rim can reuse it. */
function buildClassicBaseStrips(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gridSize: number,
): THREE.MeshStandardMaterial {
  // Use deeper orange so bloom doesn't shift toward yellow.
  const baseStripMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: ARENA_ORANGE_DEEP,
    emissive: new THREE.Color(ARENA_ORANGE_DEEP),
    emissiveIntensity: 1.2,
    toneMapped: false,
    transparent: false,
    side: THREE.DoubleSide,
  });
  reactive.baseStripMat = baseStripMat;
  const bsh: number = 0.22;
  ([
    [new THREE.BoxGeometry(gridSize, bsh, 0.08), [0, bsh / 2, -gridSize / 2]] as [THREE.BoxGeometry, [number, number, number]],
    [new THREE.BoxGeometry(gridSize, bsh, 0.08), [0, bsh / 2, gridSize / 2]] as [THREE.BoxGeometry, [number, number, number]],
    [new THREE.BoxGeometry(0.08, bsh, gridSize), [-gridSize / 2, bsh / 2, 0]] as [THREE.BoxGeometry, [number, number, number]],
    [new THREE.BoxGeometry(0.08, bsh, gridSize), [gridSize / 2, bsh / 2, 0]] as [THREE.BoxGeometry, [number, number, number]],
  ] as [THREE.BoxGeometry, [number, number, number]][]).forEach(([geo, pos]) => {
    const s: THREE.Mesh = new THREE.Mesh(geo, baseStripMat);
    s.position.set(...pos);
    scene.add(s);
  });
  return baseStripMat;
}

/** Top-edge perimeter line + vertical accent lines at the 4 corners. */
function buildClassicEdgeLines(scene: THREE.Scene, geom: ClassicGeometry): void {
  // Top edge line
  const edgeMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({ color: ARENA_TEAL_BRIGHT, transparent: true, opacity: 0.4 });
  const topEdgeGeo: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(
    geom.edgePts.map(([x, z]) => new THREE.Vector3(x, geom.barrierH, z))
  );
  scene.add(new THREE.Line(topEdgeGeo, edgeMat));

  // Corner vertical accent lines
  const cornerLineMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({ color: ARENA_TEAL_BRIGHT, transparent: true, opacity: 0.5 });
  geom.corners.forEach(([x, z]) => {
    const geo: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, z), new THREE.Vector3(x, geom.barrierH, z)
    ]);
    scene.add(new THREE.Line(geo, cornerLineMat));
  });
}

/** Point lights at corners (and midpoints at full lighting). */
function buildClassicWallLights(scene: THREE.Scene, gfx: GfxSettings, geom: ClassicGeometry): void {
  if (gfx.lighting === 'minimal') return;
  const wallLightPos: number[][] = gfx.lighting === 'reduced'
    ? geom.corners.map(([x, z]) => [x, 1, z])
    : [...geom.corners.map(([x, z]) => [x, 1, z]), [0, 1, -PLAY_HALF], [0, 1, PLAY_HALF], [-PLAY_HALF, 1, 0], [PLAY_HALF, 1, 0]];
  wallLightPos.forEach((pos: number[]) => {
    const wl: THREE.PointLight = new THREE.PointLight(ARENA_ORANGE_DEEP, 0.4, 25);
    wl.position.set(pos[0], pos[1], pos[2]);
    scene.add(wl);
  });
}

/** Ring-shaped stadium floor with a square hole for the play area. */
function buildClassicStadiumFloor(scene: THREE.Scene, geom: ClassicGeometry): void {
  const stadiumFloorR: number = PLAY_HALF + 30 + 7 * 12 + 20;
  const circleShape: THREE.Shape = new THREE.Shape();
  const segs = 128;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * stadiumFloorR;
    const y = Math.sin(a) * stadiumFloorR;
    if (i === 0) circleShape.moveTo(x, y);
    else circleShape.lineTo(x, y);
  }
  // Square hole matching the arena boundary
  const hole: THREE.Path = new THREE.Path();
  hole.moveTo(-PLAY_HALF, -PLAY_HALF);
  hole.lineTo(PLAY_HALF, -PLAY_HALF);
  hole.lineTo(PLAY_HALF, PLAY_HALF);
  hole.lineTo(-PLAY_HALF, PLAY_HALF);
  hole.lineTo(-PLAY_HALF, -PLAY_HALF);
  circleShape.holes.push(hole);
  const stadiumFloorGeo: THREE.ShapeGeometry = new THREE.ShapeGeometry(circleShape);
  const stadiumFloorMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: 0x020305,
    emissive: 0x021214,
    emissiveIntensity: 0.1,
    metalness: 0.4,
    roughness: 0.6,
  });
  const stadiumFloor: THREE.Mesh = new THREE.Mesh(stadiumFloorGeo, stadiumFloorMat);
  stadiumFloor.rotation.x = -Math.PI / 2;
  stadiumFloor.position.y = geom.barrierH;
  scene.add(stadiumFloor);
}

/** Stepped tier structure on all 4 sides of the arena with accent strips. */
function buildClassicStands(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  gridSize: number,
  standBase: number,
): void {
  const tierStart: number = 0;

  const standMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: 0x020305,
    metalness: 0.35,
    roughness: 0.65,
  });
  const standAccentMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: 0x184D51,
    emissive: 0x0B363D,
    emissiveIntensity: 0.112,
    metalness: 0.4,
    roughness: 0.6,
  });
  const standGlowMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: 0x2D6469,
    emissive: 0x49A2B2,
    emissiveIntensity: 0.168,
  });

  const sides: Array<{ dir: [number, number, number]; right: [number, number, number] }> = [
    { dir: [0, 0, -1], right: [1, 0, 0] },
    { dir: [0, 0, 1], right: [-1, 0, 0] },
    { dir: [-1, 0, 0], right: [0, 0, 1] },
    { dir: [1, 0, 0], right: [0, 0, -1] },
  ];

  sides.forEach(({ dir, right }) => {
    for (let tier = tierStart; tier < TIER_COUNT; tier++) {
      const y: number = BARRIER_H + tier * TIER_HEIGHT;
      const depth: number = standBase + tier * TIER_DEPTH;
      const width: number = gridSize + STADIUM_OFFSET * 2 + tier * TIER_DEPTH * 2;

      const tierGeo: THREE.BoxGeometry = new THREE.BoxGeometry(
        Math.abs(right[0]) > 0 ? width : TIER_DEPTH,
        TIER_HEIGHT,
        Math.abs(right[2]) > 0 ? width : TIER_DEPTH
      );
      const tierMesh: THREE.Mesh = new THREE.Mesh(tierGeo, standMat);
      const cx: number = dir[0] * (depth + TIER_DEPTH / 2);
      const cz: number = dir[2] * (depth + TIER_DEPTH / 2);
      tierMesh.position.set(cx, y + TIER_HEIGHT / 2, cz);
      scene.add(tierMesh);

      if (gfx.arenaDetail !== 'minimal' && (gfx.arenaDetail === 'full' || tier % 2 === 0)) {
        const stripW: number = Math.abs(right[0]) > 0 ? width : 0.15;
        const stripD: number = Math.abs(right[2]) > 0 ? width : 0.15;
        const mat: THREE.MeshStandardMaterial = tier % 2 === 0 ? standGlowMat.clone() : standAccentMat.clone();
        const stripGeo: THREE.BoxGeometry = new THREE.BoxGeometry(stripW, 0.3, stripD);
        const strip: THREE.Mesh = new THREE.Mesh(stripGeo, mat);
        strip.position.set(dir[0] * depth, y + TIER_HEIGHT + 0.15, dir[2] * depth);
        strip.scale.y = 0.3;
        scene.add(strip);
        const phase: number = Math.random() * Math.PI * 2;
        const drift: number = 0.5 + Math.random() * 1.5;
        reactive.tierStrips.push({ mesh: strip, tier, baseIntensity: mat.emissiveIntensity, phase, drift });
      }
    }
  });
}

/** Outer hull cylinder, accent rings, rim band, top glow torus.
 *  Returns the rim top Y used as roofY in the parent builder. */
function buildClassicOuterHull(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  outerWallR: number,
  outerWallH: number,
  baseStripMat: THREE.MeshStandardMaterial,
): number {
  if (!_cachedHullTex) {
    const hullCanvas: HTMLCanvasElement = document.createElement('canvas');
    hullCanvas.width = 4;
    hullCanvas.height = 256;
    const hCtx: CanvasRenderingContext2D = hullCanvas.getContext('2d')!;
    const hGrad: CanvasGradient = hCtx.createLinearGradient(0, 0, 0, 256);
    hGrad.addColorStop(0, 'rgba(2, 3, 5, 1)');
    hGrad.addColorStop(0.88, 'rgba(2, 3, 5, 1)');
    hGrad.addColorStop(1, 'rgba(2, 3, 5, 0)');
    hCtx.fillStyle = hGrad;
    hCtx.fillRect(0, 0, 4, 256);
    _cachedHullTex = new THREE.CanvasTexture(hullCanvas);
  }
  const hullTex: THREE.CanvasTexture = _cachedHullTex;

  const cylSegs: number = gfx.arenaDetail === 'minimal' ? 32 : gfx.arenaDetail === 'reduced' ? 64 : 128;
  const outerWallGeo: THREE.CylinderGeometry = new THREE.CylinderGeometry(outerWallR, outerWallR, outerWallH, cylSegs, 1, true);
  const outerWall: THREE.Mesh = new THREE.Mesh(outerWallGeo, new THREE.MeshBasicMaterial({
    map: hullTex,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  }));
  outerWall.position.y = outerWallH / 2;
  outerWall.renderOrder = -5;  // draw first, behind everything
  scene.add(outerWall);

  reactive.accentRings = [];
  if (gfx.arenaDetail === 'full') {
    const accentRingMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
      color: 0x184D51, emissive: 0x0B363D, emissiveIntensity: 0.08,
    });
    for (let i = 0; i < 5; i++) {
      const ry: number = outerWallH * (0.12 + i * 0.19);
      const torusSegs: number = gfx.arenaDetail === 'full' ? 128 : 64;
      const geo: THREE.TorusGeometry = new THREE.TorusGeometry(outerWallR - 0.1, 0.2, 6, torusSegs);
      const mat: THREE.MeshStandardMaterial = accentRingMat.clone();
      const ring: THREE.Mesh = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ry;
      ring.renderOrder = -4;  // right in front of outer hull, still behind stands/arena wall
      scene.add(ring);
      reactive.accentRings.push(ring);
    }
  }

  const rimBandH: number = 1.5;
  const rimBandGeo: THREE.CylinderGeometry = new THREE.CylinderGeometry(outerWallR + 0.5, outerWallR + 0.5, rimBandH, cylSegs, 1, true);
  const rimBandMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: 0x020305,
    emissive: 0x030a0c,
    emissiveIntensity: 0.038,
    metalness: 0.95,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });
  const rimBand: THREE.Mesh = new THREE.Mesh(rimBandGeo, rimBandMat);
  rimBand.position.y = outerWallH + rimBandH / 2;
  scene.add(rimBand);

  const topRimGlowGeo: THREE.TorusGeometry = new THREE.TorusGeometry(outerWallR + 0.3, 0.3, 8, cylSegs);
  const topRimGlowMat: THREE.MeshStandardMaterial = baseStripMat;
  const topRimGlow: THREE.Mesh = new THREE.Mesh(topRimGlowGeo, topRimGlowMat);
  topRimGlow.rotation.x = Math.PI / 2;
  topRimGlow.position.y = outerWallH + 0.3;
  scene.add(topRimGlow);

  return outerWallH + rimBandH;
}

/** Four point lights surrounding the stands at the back of the arena. */
function buildClassicStadiumLights(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  standBase: number,
  totalStandHeight: number,
): void {
  if (gfx.lighting === 'minimal') return;
  const stadLightDefs: Array<{ pos: [number, number, number]; color: number }> = [
    { pos: [0, totalStandHeight * 0.6, -(standBase + 30)], color: 0x0B363D },
    { pos: [0, totalStandHeight * 0.6, standBase + 30], color: 0x184D51 },
    { pos: [-(standBase + 30), totalStandHeight * 0.6, 0], color: 0x0B363D },
    { pos: [standBase + 30, totalStandHeight * 0.6, 0], color: 0x184D51 },
  ];
  const defs = gfx.lighting === 'reduced' ? stadLightDefs.slice(0, 2) : stadLightDefs;
  defs.forEach(({ pos, color }) => {
    const l: THREE.PointLight = new THREE.PointLight(color, 1.5, 200);
    l.position.set(...pos);
    scene.add(l);
    reactive.stadLights.push(l);
  });
}

/** Rave spotlight array at corners of the stadium with sweep/rest motion data. */
function buildClassicRaveSpots(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  standBase: number,
  totalStandHeight: number,
): void {
  reactive.raveSpots = [];
  if (gfx.raveSpotlights <= 0) return;

  const spotColors: number[] = [0xFC741E, 0xFAC322, 0x49A2B2, 0xFC741E, 0xFAC322, 0x2D6469, 0xFC741E, 0xFAC322];
  const cornerAngles: number[] = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const spotsPerCorner: number = gfx.raveSpotlights >= 8 ? 2 : 1;
  const restAngles: number[] = [
    -0.35, 0.20,
     0.40, -0.15,
    -0.25, 0.45,
     0.30, -0.40,
  ];
  cornerAngles.forEach((angle: number, i: number) => {
    const r: number = standBase + TIER_COUNT * TIER_DEPTH * 0.5;
    const x: number = Math.cos(angle) * r;
    const z: number = Math.sin(angle) * r;
    const y: number = totalStandHeight * 0.7;
    for (let j = 0; j < spotsPerCorner; j++) {
      const idx: number = i * 2 + j;
      const sweepDir: 1 | -1 = idx % 2 === 0 ? 1 : -1;
      const spot: THREE.SpotLight = new THREE.SpotLight(spotColors[idx % spotColors.length], 3, 300, Math.PI / 6, 0.5, 1);
      spot.position.set(x, y + j * 10, z);
      spot.target.position.set(0, 0, 0);
      scene.add(spot);
      scene.add(spot.target);
      reactive.raveSpots.push({
        light: spot, baseAngle: angle,
        speed: 0.3 + j * 0.15 + i * 0.08,
        phase: i * Math.PI * 0.5 + j * Math.PI * 0.7,
        radius: r * 0.6, baseY: y + j * 10,
        sweepDir,
        restAngle: restAngles[idx % restAngles.length],
      });
    }
  });
}
