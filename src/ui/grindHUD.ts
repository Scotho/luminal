import * as THREE from 'three';

// ── Balance meter dimensions & thresholds ────────────────
// Kept in sync with sim constants in src/core/simulation.ts.
const BAR_WIDTH = 3.2;
const BAR_HEIGHT = 0.18;
const BAR_Y_OFFSET = 3.6;
const GRIND_SWEET_SPOT = 0.30;
const GRIND_DANGER_ZONE = 0.75;

// ── Min-size enforcement when zoomed out ─────────────────
// At REF_DIST the bar is 1× scale. Beyond that it scales up
// so it stays readable at max camera distance (~37 units).
const REF_DIST = 14;
const MAX_SCALE = 2.8;

// ── Luminal neon palette ─────────────────────────────────
const COLOR_SWEET = 0x00d4ff;     // cyan
const COLOR_NORMAL = 0xffb020;    // amber
const COLOR_DANGER = 0xff2080;    // magenta
const COLOR_BAR_BORDER = 0x00d4ff; // cyan border
const COLOR_BAR_BG = 0x0a0a14;   // near-black
const COLOR_SWEET_ZONE = 0x00d4ff;
const COLOR_EDGE_MARKER = 0xff2080;

// ── Pulse wrap period (100 full sine cycles ≈ 628s before reset) ──
const PULSE_WRAP = Math.PI * 200;

// ── Triangle indicator geometry ──────────────────────────
function createTriangleGeometry(width: number, height: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  // Downward-pointing triangle (like THPS2's arrow indicator)
  const vertices = new Float32Array([
    -width / 2, height / 2, 0,   // top-left
    width / 2, height / 2, 0,    // top-right
    0, -height / 2, 0,           // bottom-center (point)
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return geo;
}

export class GrindHUD {
  private _group: THREE.Group;
  private _barBg: THREE.Mesh;
  private _barBorder: THREE.LineSegments;
  private _pip: THREE.Mesh;
  private _sweetZone: THREE.Mesh;
  private _dangerMarkerL: THREE.Mesh;
  private _dangerMarkerR: THREE.Mesh;
  private _pipGlow: THREE.Mesh;
  // Cached typed material refs (avoid per-frame `as` casts)
  private _bgMat: THREE.MeshBasicMaterial;
  private _borderMat: THREE.LineBasicMaterial;
  private _pipMat: THREE.MeshBasicMaterial;
  private _glowMat: THREE.MeshBasicMaterial;
  private _sweetMat: THREE.MeshBasicMaterial;
  private _dangerMatL: THREE.MeshBasicMaterial;
  private _dangerMatR: THREE.MeshBasicMaterial;
  private _opacity = 0;
  private _targetOpacity = 0;
  private _visualBalance = 0; // smoothed for display
  private _sweetPulse = 0;    // animation timer for sweet spot glow
  private _wasInSweetSpot = false;   // sweet-spot transition tracking
  private _sweetFlashTimer = 0;      // one-shot lock-in flash countdown
  private _trailDifficulty: 'easy' | 'normal' | 'hard' = 'normal';
  private _borderBaseColor = new THREE.Color(COLOR_BAR_BORDER);

  constructor(scene: THREE.Scene) {
    this._group = new THREE.Group();
    this._group.visible = false;

    // Background bar — dark translucent
    const bgGeo = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    const bgMat = new THREE.MeshBasicMaterial({
      color: COLOR_BAR_BG, transparent: true, opacity: 0.92,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._barBg = new THREE.Mesh(bgGeo, bgMat);
    this._group.add(this._barBg);

    // Neon border outline
    const borderMat = new THREE.LineBasicMaterial({
      color: COLOR_BAR_BORDER, transparent: true, opacity: 1.0,
      depthTest: false, linewidth: 2,
    });
    const borderSource = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    this._barBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(borderSource),
      borderMat,
    );
    borderSource.dispose();
    this._barBorder.position.z = 0.0005;
    this._group.add(this._barBorder);

    // Sweet spot zone — pulsing cyan glow
    const sweetWidth = BAR_WIDTH * GRIND_SWEET_SPOT;
    const sweetGeo = new THREE.PlaneGeometry(sweetWidth, BAR_HEIGHT * 1.55);
    const sweetMat = new THREE.MeshBasicMaterial({
      color: COLOR_SWEET_ZONE, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._sweetZone = new THREE.Mesh(sweetGeo, sweetMat);
    this._sweetZone.position.z = 0.001;
    this._group.add(this._sweetZone);

    // Danger zone edge markers — thicker, brighter magenta bars
    const markerGeo = new THREE.PlaneGeometry(0.035, BAR_HEIGHT * 1.9);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLOR_EDGE_MARKER, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._dangerMarkerL = new THREE.Mesh(markerGeo, markerMat.clone());
    this._dangerMarkerL.position.x = -GRIND_DANGER_ZONE * (BAR_WIDTH / 2);
    this._dangerMarkerL.position.z = 0.001;
    this._group.add(this._dangerMarkerL);

    this._dangerMarkerR = new THREE.Mesh(markerGeo.clone(), markerMat.clone());
    this._dangerMarkerR.position.x = GRIND_DANGER_ZONE * (BAR_WIDTH / 2);
    this._dangerMarkerR.position.z = 0.001;
    this._group.add(this._dangerMarkerR);

    // Pip glow — wider halo behind the triangle
    const glowGeo = new THREE.PlaneGeometry(0.32, BAR_HEIGHT * 3.2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: COLOR_SWEET, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._pipGlow = new THREE.Mesh(glowGeo, glowMat);
    this._pipGlow.position.z = 0.0015;
    this._group.add(this._pipGlow);

    // Triangle indicator (THPS2-style downward arrow) — much larger
    const triGeo = createTriangleGeometry(0.18, BAR_HEIGHT * 2.6);
    const triMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      side: THREE.DoubleSide, depthTest: false,
    });
    this._pip = new THREE.Mesh(triGeo, triMat);
    this._pip.position.z = 0.002;
    this._group.add(this._pip);

    // Cache typed material refs for hot-path access
    this._bgMat = bgMat;
    this._borderMat = borderMat;
    this._pipMat = triMat;
    this._glowMat = glowMat;
    this._sweetMat = sweetMat;
    this._dangerMatL = this._dangerMarkerL.material as THREE.MeshBasicMaterial;
    this._dangerMatR = this._dangerMarkerR.material as THREE.MeshBasicMaterial;

    scene.add(this._group);
  }

  show(): void {
    this._targetOpacity = 1;
    this._group.visible = true;
  }

  hide(): void {
    this._targetOpacity = 0;
  }

  /** Subtle visual cue — tints the border to indicate trail difficulty. */
  setTrailDifficulty(difficulty: 'easy' | 'normal' | 'hard'): void {
    if (this._trailDifficulty === difficulty) return;
    this._trailDifficulty = difficulty;
    const base = new THREE.Color(COLOR_BAR_BORDER); // cyan
    if (difficulty === 'easy') {
      // Lerp toward green/blue
      this._borderBaseColor.copy(base).lerp(new THREE.Color(0x20ff80), 0.35);
    } else if (difficulty === 'hard') {
      // Lerp toward orange/red
      this._borderBaseColor.copy(base).lerp(new THREE.Color(0xff6020), 0.35);
    } else {
      this._borderBaseColor.copy(base);
    }
  }

  update(
    dt: number,
    worldX: number, worldY: number, worldZ: number,
    balance: number,
    camera: THREE.Camera,
  ): void {
    // Fade in/out
    this._opacity += (this._targetOpacity - this._opacity) * Math.min(1, 8 * dt);
    if (this._opacity < 0.01) {
      this._group.visible = false;
      return;
    }
    this._group.visible = true;

    // Billboard — face camera
    this._group.position.set(worldX, worldY + BAR_Y_OFFSET, worldZ);
    this._group.quaternion.copy(camera.quaternion);

    // Scale up when camera is far so the bar stays readable at max zoom
    const dist = camera.position.distanceTo(this._group.position);
    const scale = Math.min(MAX_SCALE, Math.max(1, dist / REF_DIST));
    this._group.scale.setScalar(scale);

    // Smooth the visual pip toward actual balance (prevents jarring jumps)
    const lerpSpeed = 18; // fast enough to feel responsive, slow enough to smooth
    this._visualBalance += (balance - this._visualBalance) * Math.min(1, lerpSpeed * dt);

    const absBal = Math.abs(this._visualBalance);

    // ── Danger zone shake (deterministic, no Math.random) ──
    if (absBal >= GRIND_DANGER_ZONE) {
      const t = (absBal - GRIND_DANGER_ZONE) / (1 - GRIND_DANGER_ZONE);
      const intensity = t * 0.06;
      // Time-based pseudo-random shake using irrational multipliers
      const px = this._sweetPulse;
      this._group.position.x += Math.sin(px * 137.5) * intensity;
      this._group.position.y += Math.sin(px * 251.3) * intensity;
      // Border flashes magenta in danger
      this._borderMat.color.setHex(COLOR_DANGER);
    } else {
      this._borderMat.color.copy(this._borderBaseColor);
    }

    // ── Pip position & color ──
    const pipX = this._visualBalance * (BAR_WIDTH / 2);
    this._pip.position.x = pipX;
    this._pipGlow.position.x = pipX;

    if (absBal < GRIND_SWEET_SPOT) {
      this._pipMat.color.setHex(COLOR_SWEET);
      this._glowMat.color.setHex(COLOR_SWEET);
    } else if (absBal < GRIND_DANGER_ZONE) {
      this._pipMat.color.setHex(COLOR_NORMAL);
      this._glowMat.color.setHex(COLOR_NORMAL);
    } else {
      this._pipMat.color.setHex(COLOR_DANGER);
      this._glowMat.color.setHex(COLOR_DANGER);
    }

    // Danger markers brighten when balance enters danger zone
    const dangerActive = absBal >= GRIND_DANGER_ZONE;
    const markerOpacity = dangerActive ? 1.0 : 0.75;
    this._dangerMatL.opacity = markerOpacity * this._opacity;
    this._dangerMatR.opacity = markerOpacity * this._opacity;

    // ── Sweet spot pulse animation ──
    const inSweetSpot = absBal < GRIND_SWEET_SPOT;
    if (inSweetSpot && !this._wasInSweetSpot) {
      this._sweetFlashTimer = 0.1;
    }
    this._wasInSweetSpot = inSweetSpot;
    if (this._sweetFlashTimer > 0) {
      this._sweetFlashTimer = Math.max(0, this._sweetFlashTimer - dt);
    }

    const pulseSpeed = inSweetSpot ? 6.0 : 3.0;
    this._sweetPulse = (this._sweetPulse + dt * pulseSpeed) % PULSE_WRAP;
    const pulseVal = Math.sin(this._sweetPulse);
    const pulseOpacity = 0.15 + pulseVal * (inSweetSpot ? 0.2 : 0.1);
    if (inSweetSpot) {
      const flashBoost = this._sweetFlashTimer > 0 ? 0.5 : 0;
      this._sweetMat.opacity = (pulseOpacity + 0.15 + flashBoost) * this._opacity;
      const scaleFactor = 1.0 + pulseVal * 0.1;
      this._sweetZone.scale.set(scaleFactor, scaleFactor, 1);
    } else {
      this._sweetMat.opacity = pulseOpacity * this._opacity;
      this._sweetZone.scale.set(1, 1, 1);
    }

    // ── Apply master opacity ──
    this._bgMat.opacity = 0.92 * this._opacity;
    this._borderMat.opacity = 1.0 * this._opacity;
    this._pipMat.opacity = this._opacity;
    this._glowMat.opacity = 0.55 * this._opacity;
  }

  dispose(): void {
    this._group.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this._group.removeFromParent();
  }
}
