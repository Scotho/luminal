import * as THREE from 'three';
import type { GfxSettings } from '../types/index';
import { cloneDroneModel } from '../droneModel';
import { createStarTexture, starSize, starColor, createStarMaterial } from '../starfield';
import type { ReactiveState, SatelliteEntry, FlyoverShipEntry } from './arenaState';
import { HALF } from './arenaShape';

/** Build the spectator drone and assign it into `reactive.spectatorDrone`. */
export function buildSpectatorDrone(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
): void {
  reactive.spectatorDrone = null;
  if (gfx.arenaDetail === 'minimal') return;

  const drone: THREE.Group = cloneDroneModel();
  drone.scale.setScalar(3.5);

  const recLight: THREE.PointLight = new THREE.PointLight(0xff2222, 3.0, 15);
  recLight.position.set(0, 0.5, 0);
  drone.add(recLight);

  const startR: number = HALF * 0.85;
  const startY: number = 45;
  drone.position.set(startR, startY, 0);
  scene.add(drone);
  reactive.spectatorDrone = {
    mesh: drone, angle: 0, recLight,
    orbitR: startR, targetR: startR,
    flyY: startY, targetY: startY,
    bankAngle: 0, pitchAngle: 0,
  };
}

/** Build starfield + horizon star band (V2 only). */
export function buildStarfield(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  portholeR: number,
  roofY: number,
  isArenaV2: boolean,
): void {
  const starCount: number = 2000;
  const starGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
  const starPositions: Float32Array = new Float32Array(starCount * 3);
  const starColors: Float32Array = new Float32Array(starCount * 3);
  const skyHeight: number = roofY + 30;
  const starSizes: Float32Array = new Float32Array(starCount);
  const starBrightness: Float32Array = new Float32Array(starCount);
  const starPhases: Float32Array = new Float32Array(starCount);
  const starFreqs: Float32Array = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    const i3: number = i * 3;

    // Hemispherical distribution at varying radii
    const phi: number = Math.acos(1 - Math.random() * 0.95);
    const theta: number = Math.random() * Math.PI * 2;
    const radius: number = portholeR * (1.5 + Math.random() * 2.5);
    starPositions[i3] = Math.sin(phi) * Math.cos(theta) * radius;
    starPositions[i3 + 1] = Math.cos(phi) * radius + skyHeight;
    starPositions[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

    // Power-law size + correlated brightness
    const size: number = starSize();
    starSizes[i] = size;
    // Brightness floor 0.55 so even dim stars are clearly visible;
    // scales up to ~1.0 for hero stars
    const brightness: number = 0.55 + (size / 4.0) * 0.45 * (0.8 + Math.random() * 0.2);
    starBrightness[i] = brightness;

    // Per-star twinkle parameters (set once, animated on GPU)
    starPhases[i] = Math.random() * Math.PI * 2;
    starFreqs[i] = 0.5 + Math.random() * 2.0;

    // Blackbody color temperature with cyberpunk accents.
    // Store raw color; shader multiplies by vBrightness (don't double-apply).
    const [r, g, b] = starColor(brightness, size);
    starColors[i3] = r;
    starColors[i3 + 1] = g;
    starColors[i3 + 2] = b;
  }

  const starTexture: THREE.CanvasTexture = createStarTexture();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('aBrightness', new THREE.BufferAttribute(starBrightness, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
  starGeo.setAttribute('aFreq', new THREE.BufferAttribute(starFreqs, 1));

  const starMat: THREE.ShaderMaterial = createStarMaterial(starTexture, gfx.pixelRatio);
  const starMesh: THREE.Points = new THREE.Points(starGeo, starMat);
  scene.add(starMesh);
  reactive.starMesh = starMesh;
  reactive.starMaterial = starMat;
  reactive.starBaseSizes = null;

  // ── Horizon star band (arena_v2 only — fills the sky down to eye level) ──
  if (isArenaV2) {
    const hCount: number = 1500;
    const hGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
    const hPos: Float32Array = new Float32Array(hCount * 3);
    const hCol: Float32Array = new Float32Array(hCount * 3);
    const hSizes: Float32Array = new Float32Array(hCount);
    const hBright: Float32Array = new Float32Array(hCount);
    const hPhases: Float32Array = new Float32Array(hCount);
    const hFreqs: Float32Array = new Float32Array(hCount);
    for (let i = 0; i < hCount; i++) {
      const i3: number = i * 3;

      // Lower hemisphere — fills sky from horizon up to roof
      const phi: number = Math.acos(Math.random() * 0.7);
      const theta: number = Math.random() * Math.PI * 2;
      const radius: number = portholeR * (2 + Math.random() * 2);
      hPos[i3] = Math.sin(phi) * Math.cos(theta) * radius;
      hPos[i3 + 1] = 5 + Math.cos(phi) * radius * 0.3 + Math.random() * (skyHeight - 5);
      hPos[i3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;

      const size: number = 0.25 + Math.pow(Math.random(), 2.5) * 1.75;
      hSizes[i] = size;
      const brightness: number = 0.45 + (size / 2.0) * 0.4 * (0.8 + Math.random() * 0.2);
      hBright[i] = brightness;
      hPhases[i] = Math.random() * Math.PI * 2;
      hFreqs[i] = 0.5 + Math.random() * 2.0;

      const [r, g, b] = starColor(brightness, size);
      hCol[i3] = r;
      hCol[i3 + 1] = g;
      hCol[i3 + 2] = b;
    }
    hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
    hGeo.setAttribute('color', new THREE.BufferAttribute(hCol, 3));
    hGeo.setAttribute('aSize', new THREE.BufferAttribute(hSizes, 1));
    hGeo.setAttribute('aBrightness', new THREE.BufferAttribute(hBright, 1));
    hGeo.setAttribute('aPhase', new THREE.BufferAttribute(hPhases, 1));
    hGeo.setAttribute('aFreq', new THREE.BufferAttribute(hFreqs, 1));
    scene.add(new THREE.Points(hGeo, createStarMaterial(starTexture, gfx.pixelRatio)));
  }
}

/** Build satellites + flyover ships. */
export function buildOrbiters(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  portholeR: number,
  roofY: number,
): void {
  // ── Shared: Satellites ──────────────────────────────────
  const satellites: SatelliteEntry[] = [];
  if (gfx.arenaDetail !== 'minimal') {
    const satMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({ color: 0x0a1a1c, metalness: 0.9, roughness: 0.2 });
    const satGlowMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({ color: 0x49A2B2, emissive: 0x184D51, emissiveIntensity: 0.8 });
    for (let i = 0; i < 2; i++) {
      const sat: THREE.Group = new THREE.Group();
      sat.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 1), satMat));
      for (const side of [-1, 1]) {
        const panel: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 1.5), satGlowMat);
        panel.position.set(side * 3.2, 0, 0);
        sat.add(panel);
      }
      const ant: THREE.Mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4), satMat);
      ant.position.y = 1;
      sat.add(ant);
      const blink: THREE.PointLight = new THREE.PointLight(0xff2222, 0.5, 8);
      blink.position.y = 1.5;
      sat.add(blink);
      const orbitR: number = portholeR * (0.3 + i * 0.4);
      const orbitY: number = roofY + 40 + i * 30;
      const orbitSpeed: number = 0.03 + i * 0.02;
      const startAngle: number = i * Math.PI;
      sat.position.set(Math.cos(startAngle) * orbitR, orbitY, Math.sin(startAngle) * orbitR);
      scene.add(sat);
      satellites.push({ mesh: sat, orbitR, orbitY, orbitSpeed, startAngle, blink });
    }
  }
  reactive.satellites = satellites;

  // ── Shared: Flyover Ships ───────────────────────────────
  const flyoverShips: FlyoverShipEntry[] = [];
  if (gfx.arenaDetail === 'full') {
    const shipBodyMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({ color: 0x081418, metalness: 0.9, roughness: 0.2 });
    const shipEngMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({ color: 0x49A2B2, emissive: 0x49A2B2, emissiveIntensity: 1.5 });
    for (let i = 0; i < 3; i++) {
      const ship: THREE.Group = new THREE.Group();
      const fuse: THREE.Mesh = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.5, 6), shipBodyMat);
      fuse.rotation.x = Math.PI / 2;
      ship.add(fuse);
      for (const side of [-1, 1]) {
        const wing: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.8), shipBodyMat);
        wing.position.set(side * 1.3, 0, 0.2);
        ship.add(wing);
      }
      ship.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), shipEngMat));
      const engLight: THREE.PointLight = new THREE.PointLight(0x49A2B2, 0.8, 12);
      engLight.position.set(0, 0, 1.5);
      ship.add(engLight);
      ship.scale.setScalar(1.5 + Math.random());
      const orbitR: number = portholeR * (0.5 + Math.random() * 0.8);
      const orbitY: number = roofY + 20 + Math.random() * 50;
      const orbitSpeed: number = 0.06 + Math.random() * 0.08;
      const startAngle: number = Math.random() * Math.PI * 2;
      ship.position.set(0, orbitY, 0);
      scene.add(ship);
      flyoverShips.push({ mesh: ship, orbitR, orbitY, orbitSpeed, startAngle });
    }
  }
  reactive.flyoverShips = flyoverShips;
}

/** Dev-only GPU budget summary. Matches existing console format. */
export function logGpuBudget(scene: THREE.Scene, reactive: ReactiveState, gfx: GfxSettings): void {
  if (!import.meta.env.DEV) return;
  const r = reactive;
  let pointLights = 0;
  let spotLights = 0;
  let meshCount = 0;
  let shaderMaterials = 0;
  const renderTargets: string[] = [];

  // Count all lights in scene
  scene.traverse((obj: THREE.Object3D) => {
    if ((obj as THREE.PointLight).isPointLight) pointLights++;
    if ((obj as THREE.SpotLight).isSpotLight) spotLights++;
    if ((obj as THREE.Mesh).isMesh) meshCount++;
    const mat = (obj as THREE.Mesh).material;
    if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) shaderMaterials++;
  });

  // Render targets
  if (r.reflector) renderTargets.push(`reflector (${gfx.reflections === 'ultra' ? '1.0x' : '0.5x'})`);
  if (r.atmosphere?.mistMeshes.length) renderTargets.push(`mist (${r.atmosphere.mistMeshes.length} layers)`);

  // V2 mesh groups
  const v2Counts = {
    floor: r.v2ArenaFloor.length,
    walls: r.v2ArenaWall.length + r.v2WallBarrier.length + r.v2WallBody.length,
    markers: r.v2WallMarkers.length,
    buildings: r.v2Buildings.length + r.v2BuildingFaces.length + r.v2BuildingAccentWindows.length,
    stands: r.v2CrowdStands.length,
    glow: r.v2GlowCyan.length + r.v2GlowBlue.length,
    floodLights: r.v2FloodLights.length,
    trim: r.v2CoolTrim.length + r.v2SkylineEdges.length,
  };

  console.log(
    '%c[GPU BUDGET]%c Arena created\n' +
    `  Preset: ${gfx.preset} | Reflections: ${gfx.reflections} | Bloom: ${gfx.bloom.enabled ? gfx.bloom.strength : 'off'} | Atmosphere: ${gfx.atmosphere}\n` +
    `  Pixel ratio: ${gfx.pixelRatio} | Antialias: ${gfx.antialias}\n` +
    `  ── Scene totals ──\n` +
    `  Meshes: ${meshCount} | PointLights: ${pointLights} | SpotLights: ${spotLights} | ShaderMaterials: ${shaderMaterials}\n` +
    `  Render targets: ${renderTargets.length ? renderTargets.join(', ') : 'none'}\n` +
    `  ── Arena V2 meshes ──\n` +
    `  Floor: ${v2Counts.floor} | Walls: ${v2Counts.walls} | Markers: ${v2Counts.markers}\n` +
    `  Buildings: ${v2Counts.buildings} | Stands: ${v2Counts.stands} | Glow: ${v2Counts.glow}\n` +
    `  Flood lights: ${v2Counts.floodLights} | Trim: ${v2Counts.trim}\n` +
    `  ── Extras ──\n` +
    `  Stars: ${r.starMesh ? 'yes' : 'no'} | Satellites: ${r.satellites?.length ?? 0}\n` +
    `  Flyovers: ${r.flyoverShips?.length ?? 0} | Drone: ${r.spectatorDrone ? 'yes' : 'no'}\n` +
    `  Rave spots: ${r.raveSpots.length} | Stadium lights: ${r.stadLights.length}\n` +
    `  Reflector: ${r.reflector ? 'active' : 'off'}`,
    'color: #49A2B2; font-weight: bold', 'color: inherit'
  );
}
