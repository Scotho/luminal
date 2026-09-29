// ── Demo Mode ──────────────────────────────────────────
// Extracted from game.ts — menu demo logic: AI players, orbit camera,
// intro animation, map transitions, and menu replay bridging.
// Supports 2–N players via startWithConfig() for match-preview demos.

import { Player } from '../player';
import { createArena, isOutOfBounds, setSpectatorTargets, ARENA_SIZE } from '../grid';
import { getAIInput, createAIState, AI_SKIP_OWN } from '../ai';
import { updateCamera, resetCamera } from '../scene';
import { HIT_RADIUS } from '../core/simulation';
import { grid } from '../spatialGrid';
import * as THREE from 'three';
import { getPlayerColor, MENU_DEMO_COLOR_KEYS } from '../playerColors';
import { getSelectedMap } from '../ui/mapSelectUI';
import { isBikeModelLoaded } from '../bikeModel';
import { isCarModelLoaded } from '../carModel';
import { isHoverboardModelLoaded } from '../hoverboardModel';
import { isArenaModelLoaded } from '../arenaModel';
import { showMapTransition, hideMapTransition } from '../ui/mapTransition';
import type { AIState, AIInput, ColorEntry, VehicleType, MapType, IDemoModeHost } from '../types/index';
import { EVT_MAP_CHANGED } from '../events';

// Scratch vectors for demo camera collision avoidance (module-scoped, zero-alloc)
const _camCollTmp = new THREE.Vector3();
const _camCollLook = new THREE.Vector3();
const _camCollDir = new THREE.Vector3();
const _demoCamRaycaster = new THREE.Raycaster();
const _lerpTarget = new THREE.Vector3();

/** Configuration for a single demo participant. */
export interface DemoParticipant {
  colorKey?: string;
  color?: ColorEntry;
  vehicle?: VehicleType;
}

export class DemoMode {
  private host: IDemoModeHost;

  // Demo players (N-player array)
  demoPlayers: Player[] = [];
  private _demoAIStates: AIState[] = [];

  /** Config for current demo participants (null = default 2-player). */
  private _config: DemoParticipant[] | null = null;

  // Backward-compat getters for adminPanel / game.ts
  get demoPlayer1(): Player | null { return this.demoPlayers[0] ?? null; }
  set demoPlayer1(v: Player | null) {
    if (v) this.demoPlayers[0] = v;
    else if (this.demoPlayers.length > 0) this.demoPlayers.splice(0, 1);
  }
  get demoPlayer2(): Player | null { return this.demoPlayers[1] ?? null; }
  set demoPlayer2(v: Player | null) {
    if (v) this.demoPlayers[1] = v;
    else if (this.demoPlayers.length > 1) this.demoPlayers.splice(1, 1);
  }

  // Demo camera & timing
  demoOrbitAngle: number = 0;
  demoRestartTimer: number = 0;
  demoTime: number = 0;
  private _demoChaseCam: boolean = false;
  private _demoChaseCamTimer: number = 0;
  private _demoCamTarget: THREE.Vector3 | null = null;
  private _demoIntroCamT: number = 0;

  // Demo map transitions
  _demoCurrentMap: MapType = 'midtown_bowl';
  _demoTransitionTimer: ReturnType<typeof setTimeout> | null = null;
  private _demoMapChangeHandler: ((e: Event) => void) | null = null;

  constructor(host: IDemoModeHost) {
    this.host = host;
    this._demoAIStates = [createAIState(undefined, 'medium'), createAIState(undefined, 'medium')];
  }

  // ── Spawn helpers ────────────────────────────────────────

  private _randomSpawns(count: number): Array<{ x: number; z: number; angle: number }> {
    const half = ARENA_SIZE / 2;
    const min = half * 0.28, max = half * 0.7;
    const baseAngle = Math.random() * Math.PI * 2;
    const spawns: Array<{ x: number; z: number; angle: number }> = [];
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (Math.PI * 2 * i) / count;
      const d = min + Math.random() * (max - min);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      spawns.push({ x, z, angle: Math.atan2(x, z) });
    }
    return spawns;
  }

  private _resolveParticipants(): Array<{ color: ColorEntry; vehicle: VehicleType }> {
    if (!this._config || this._config.length === 0) {
      // Default: 2 players with menu demo colors, bike vehicles
      return MENU_DEMO_COLOR_KEYS.map(key => ({
        color: getPlayerColor(key),
        vehicle: 'bike' as VehicleType,
      }));
    }
    return this._config.map((p, i) => {
      const color = p.color ?? getPlayerColor(p.colorKey ?? MENU_DEMO_COLOR_KEYS[i % MENU_DEMO_COLOR_KEYS.length]);
      return { color, vehicle: p.vehicle ?? 'bike' };
    });
  }

  private _modelsReady(participants: Array<{ vehicle: VehicleType }>): boolean {
    if (!isArenaModelLoaded()) return false;
    for (const p of participants) {
      if (p.vehicle === 'car' && !isCarModelLoaded()) return false;
      if (p.vehicle === 'hoverboard' && !isHoverboardModelLoaded()) return false;
      if (p.vehicle === 'bike' && !isBikeModelLoaded()) return false;
    }
    return true;
  }

  private _spawnPlayers(participants: Array<{ color: ColorEntry; vehicle: VehicleType }>): void {
    const spawns = this._randomSpawns(participants.length);
    this.demoPlayers = [];
    this._demoAIStates = [];
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const s = spawns[i];
      this.demoPlayers.push(new Player(this.host.scene, {
        color: p.color.color,
        emissive: p.color.emissive,
        startX: s.x,
        startZ: s.z,
        startAngle: s.angle,
        isAI: true,
        vehicleType: p.vehicle,
      }));
      this._demoAIStates.push(createAIState(undefined, 'medium'));
    }
  }

  // ── Public API ──────────────────────────────────────────

  /** Start the default 2-player menu demo (bikes, cyan/orange). */
  start(): void {
    this._config = null;
    this._startInternal();
  }

  /** Start a match-preview demo with specific participants (colors, vehicles).
   *  Use this to warm assets and show a preview that mirrors actual match conditions. */
  startWithConfig(participants: DemoParticipant[]): void {
    this._config = participants;
    this._startInternal();
  }

  private _startInternal(): void {
    this.host.cleanup();

    const participants = this._resolveParticipants();

    // Don't start until required models are loaded — restart() retries on load
    if (!this._modelsReady(participants)) return;

    this._demoCurrentMap = getSelectedMap();
    createArena(this.host.scene, this._demoCurrentMap);
    this.listenForMapChanges();

    this._spawnPlayers(participants);
    this.demoOrbitAngle = Math.random() * Math.PI * 2;
    this.demoRestartTimer = 0;
    this.demoTime = 0;
  }

  // Soft restart — only respawn players + clear trails, keep arena intact
  restart(): void {
    // If arena wasn't built yet (models were loading), do a full start
    if (this.demoPlayers.length === 0) { this._startInternal(); return; }
    grid.clear();
    for (const p of this.demoPlayers) p.destroy();

    const participants = this._resolveParticipants();
    this._spawnPlayers(participants);
    this.demoRestartTimer = 0;
    this.demoTime = 0;
  }

  transitionToMap(newMap: MapType): void {
    if (newMap === this._demoCurrentMap) return;
    this._demoCurrentMap = newMap;

    if (this._demoTransitionTimer) {
      clearTimeout(this._demoTransitionTimer);
      this._demoTransitionTimer = null;
    }

    const canvas = (this.host.scene.userData._renderer as THREE.WebGLRenderer)?.domElement as HTMLElement | undefined;
    if (!canvas) { this._startInternal(); return; }

    // Show loading overlay behind the menu, then fade out the 3D canvas
    showMapTransition('LOADING MAP');
    canvas.style.transition = 'opacity 0.5s';
    canvas.style.opacity = '0';

    this._demoTransitionTimer = setTimeout(() => {
      this._demoTransitionTimer = null;
      try {
        for (const p of this.demoPlayers) p.destroy();
        this.demoPlayers = [];
        this.host.cleanup();
        createArena(this.host.scene, this._demoCurrentMap);

        const participants = this._resolveParticipants();
        this._spawnPlayers(participants);
        this.demoOrbitAngle = Math.random() * Math.PI * 2;
        this.demoRestartTimer = 0;
        this.demoTime = 0;
      } catch (e) {
        console.error('[demo] map transition failed:', e);
      }

      // Always fade in canvas + hide overlay (runs regardless of error)
      canvas.style.opacity = '1';
      setTimeout(() => {
        canvas.style.transition = '';
        hideMapTransition();
      }, 500);
    }, 500);
  }

  listenForMapChanges(): void {
    this.stopListeningForMapChanges();
    this._demoMapChangeHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.map) this.transitionToMap(detail.map as MapType);
    };
    document.addEventListener(EVT_MAP_CHANGED, this._demoMapChangeHandler);
  }

  stopListeningForMapChanges(): void {
    if (this._demoMapChangeHandler) {
      document.removeEventListener(EVT_MAP_CHANGED, this._demoMapChangeHandler);
      this._demoMapChangeHandler = null;
    }
  }

  update(dt: number): void {
    const players = this.demoPlayers;
    if (players.length === 0) return;

    // Collect all trails for AI input
    const allTrails = players.map(p => p.trail);

    // Update each player
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.alive) {
        // AI sees all trails; enemy trail = first alive opponent
        const enemyTrail = allTrails.find((t, j) => j !== i && players[j].alive) ?? allTrails[0];
        const input: AIInput = getAIInput(p, allTrails, dt, this._demoAIStates[i], enemyTrail, p.trail);
        p.update(dt, input.turn, input.accelerate, input.dash, input.brake);
      } else {
        p.updateDeath(dt);
      }
    }

    // Meter recharge — each player recharges from all other trails
    for (let i = 0; i < players.length; i++) {
      if (!players[i].alive) continue;
      for (let j = 0; j < players.length; j++) {
        if (i !== j) players[i].rechargeMeter(players[j].trail, dt);
      }
    }

    // Collision detection
    const deadThisFrame: boolean[] = new Array(players.length).fill(false);
    for (let i = 0; i < players.length; i++) {
      if (!players[i].alive || deadThisFrame[i]) continue;
      const pos = players[i].getPosition();
      if (isOutOfBounds(pos.x, pos.z)) { deadThisFrame[i] = true; continue; }
      if (grid.checkCollision(pos.x, pos.z, HIT_RADIUS, players[i].trail, AI_SKIP_OWN)) { deadThisFrame[i] = true; continue; }
      // Head-on with other players
      for (let j = i + 1; j < players.length; j++) {
        if (!players[j].alive || deadThisFrame[j]) continue;
        const posj = players[j].getPosition();
        if (Math.hypot(pos.x - posj.x, pos.z - posj.z) < 2.0) {
          deadThisFrame[i] = true;
          deadThisFrame[j] = true;
        }
      }
    }
    for (let i = 0; i < players.length; i++) {
      if (deadThisFrame[i]) players[i].kill();
    }

    // Auto-restart when any player dies or demo runs too long
    const allAlive = players.every(p => p.alive);
    if (!allAlive) {
      this.demoRestartTimer += dt;
      if (this.demoRestartTimer > 3.0) {
        this.restart();
      }
    } else if (this.demoTime > 30.0) {
      this.restart();
    }

    // Demo spectator targets
    const targets: ({ x: number; z: number } | null)[] = players.map(p => p.alive ? p.getPosition() : null);
    setSpectatorTargets(targets);

    // Live radar + timer in settings
    this.demoTime += dt;
    if (this.host.settingsOpen) {
      this.host._drawSettingsPreview();
      const mins: number = Math.floor(this.demoTime / 60);
      const secs: number = Math.floor(this.demoTime % 60);
      const timerEl = document.getElementById('match-timer');
      if (timerEl) timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Camera: chase mode (for FOV/dist preview) or action-tracking mode
    if (this._demoChaseCam && players[0] && players[0].alive) {
      this._demoChaseCamTimer -= dt;
      if (this._demoChaseCamTimer <= 0) {
        this._demoChaseCam = false;
        resetCamera();
      } else if (this.host.adminFreecam) {
        this.host._updateAdminFreecam(dt);
      } else {
        updateCamera(this.host.camera, players[0], dt);
      }
    } else {
      this._demoChaseCam = false;
      // Track midpoint of alive players with dynamic orbit
      const positions: { x: number; z: number }[] = [];
      for (const p of players) {
        if (p.alive) positions.push(p.getPosition());
      }
      let cx = 0, cz = 0;
      if (positions.length > 0) {
        for (const p of positions) { cx += p.x; cz += p.z; }
        cx /= positions.length;
        cz /= positions.length;
      }
      // Distance: max pairwise spread determines camera distance
      let spread = 60;
      if (positions.length >= 2) {
        let maxDist = 0;
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            maxDist = Math.max(maxDist, Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z));
          }
        }
        spread = Math.max(40, maxDist * 0.8);
      }
      // Smooth the camera target
      if (!this._demoCamTarget) this._demoCamTarget = new THREE.Vector3(cx, 0, cz);
      this._demoCamTarget.lerp(_lerpTarget.set(cx, 0, cz), 2.0 * dt);
      // Slow orbit around the action point
      this.demoOrbitAngle += dt * 0.08;
      const orbitR: number = Math.min(75, spread + 15);
      const orbitH: number = 18 + spread * 0.14;

      // Intro rise animation: smoothly lift from floor level
      if (this._demoIntroCamT < 1) {
        this._demoIntroCamT = Math.min(1, this._demoIntroCamT + dt * 0.4); // ~2.5s rise
        const ease = 1 - Math.pow(1 - this._demoIntroCamT, 3); // ease-out cubic
        const introH = 1.5 + (orbitH - 1.5) * ease;
        const introR = orbitR * (0.6 + 0.4 * ease); // start closer, widen out
        const introFov = 50 + (62 + spread * 0.08 - 50) * ease; // narrow to wide
        this.host.camera.position.set(
          this._demoCamTarget.x + Math.cos(this.demoOrbitAngle) * introR,
          introH,
          this._demoCamTarget.z + Math.sin(this.demoOrbitAngle) * introR
        );
        this.host.camera.lookAt(this._demoCamTarget.x, 3 * ease, this._demoCamTarget.z);
        this.host.camera.fov = introFov;
      } else {
        const desiredPos = _camCollTmp.set(
          this._demoCamTarget.x + Math.cos(this.demoOrbitAngle) * orbitR,
          orbitH,
          this._demoCamTarget.z + Math.sin(this.demoOrbitAngle) * orbitR
        );
        // Pull camera in if geometry blocks the view.
        // Skip on synth_city — procgen buildings stream in/out based on
        // camera position, creating a feedback loop where the raycast hit
        // changes every few seconds and the camera flickers between
        // "pulled in" and "full orbit" as buildings appear and disappear.
        const lookAt = _camCollLook.set(this._demoCamTarget.x, 3, this._demoCamTarget.z);
        let t = 1;
        const synthRoot = this.host.scene.getObjectByName('synth_city_root');
        if (!synthRoot) {
          const dir = _camCollDir.subVectors(desiredPos, lookAt).normalize();
          const maxDist = desiredPos.distanceTo(lookAt);
          _demoCamRaycaster.set(lookAt, dir);
          _demoCamRaycaster.far = maxDist;
          _demoCamRaycaster.camera = this.host.camera;
          const hits = _demoCamRaycaster.intersectObjects(this.host.scene.children, true);
          let safeDist = maxDist;
          for (const hit of hits) {
            if (hit.distance < 2) continue;
            const obj = hit.object;
            if (obj.name.includes('trail') || obj.name.includes('player')) continue;
            if (!(obj as THREE.Mesh).isMesh) continue;
            safeDist = Math.min(safeDist, hit.distance - 1.5);
            break;
          }
          t = Math.min(1, safeDist / maxDist);
        }
        this.host.camera.position.lerpVectors(lookAt, desiredPos, t);
        this.host.camera.lookAt(lookAt);
        this.host.camera.fov = 62 + spread * 0.08;
      }
      this.host.camera.updateProjectionMatrix();
    }


  }

  // Switch demo camera to chase mode for N seconds
  enableChaseCam(seconds: number = 10): void {
    this._demoChaseCam = true;
    this._demoChaseCamTimer = seconds;
    resetCamera();
  }

  /** Tear down demo state — call when leaving menu for match/replay. */
  teardown(): void {
    this.stopListeningForMapChanges();
    if (this._demoTransitionTimer) { clearTimeout(this._demoTransitionTimer); this._demoTransitionTimer = null; }
    // Defensive cleanup: if a map transition was mid-flight when teardown fired
    // (e.g. startOnlineMatch interrupting a queued demo map swap), the LOADING
    // MAP overlay and faded canvas would otherwise stick into the next scene.
    hideMapTransition();
    const canvas = (this.host.scene.userData._renderer as THREE.WebGLRenderer)?.domElement as HTMLElement | undefined;
    if (canvas) {
      canvas.style.opacity = '';
      canvas.style.transition = '';
    }
    for (const p of this.demoPlayers) p.destroy();
    this.demoPlayers = [];
  }
}
