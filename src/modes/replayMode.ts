// ── Replay Mode ──────────────────────────────────────────
// Extracted from game.ts — replay viewer, background replay (victory screen),
// menu replay, ghost management, and replay camera system.

import { Player } from '../player';
import { Trail } from '../trail';
import { createArena } from '../grid';
import { resetCamera } from '../scene';
import { ReplayRecorder, ReplayPlayer } from '../replay';
import * as THREE from 'three';
import { FALLBACK_OPPONENT_COLOR_KEY, getPlayerColor } from '../playerColors';
import { getSelectedMap } from '../ui/mapSelectUI';
import type {
  ReplaySnapshot, ReplayFrame, InterpolatedReplayFrame, PlayerState,
  VehicleType, FreeCamInput,
} from '../types/index';
import type { IGameCore } from './index';
import type { BloomPassLike } from '../types/index';
import { updateReplayCamera } from './replayCamera';
import {
  updateBgReplay, updateBgDeathCamera, ensureBgShatterPool, spawnBgShatter,
  updateBgShatter, cleanupBgShatter, resetBgSlowMo, loopBgReplay,
} from './replayBackground';
import {
  createGhost, updateGhost, rebuildGhostTrails, destroyGhosts,
  findLastAlivePos, seekTo as seekToImpl,
} from './replayGhosts';

// ── Interfaces local to replay ──────────────────────────

export interface CamTransFrom {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

export interface GhostEntry {
  mesh: THREE.Group;
  trail: Trail;
  light: THREE.PointLight;
  lastTrailX: number | null;
  lastTrailZ: number | null;
  alive: boolean;
}

/** Narrow host interface — fields/methods ReplayMode needs from Game. */
export interface IReplayModeHost extends IGameCore {
  gameOverTimer: number;

  // Bloom
  bloomPass: BloomPassLike | null;
  baseBloomStrength: number;
  adminBloomFreeze: boolean;

  // Free cam state (shared with _updateAdminFreecam on Game)
  _freeCamPos: THREE.Vector3;
  _freeCamYaw: number;
  _freeCamPitch: number;
  _freeCamVel: THREE.Vector3;

  // Replay infrastructure (stays on Game)
  _replayRecorder: ReplayRecorder;
  _replayPlayer: ReplayPlayer;

  // Prep state (shared with result flow)
  _prepDone: boolean;
  _prebuiltPlayerGhost: GhostEntry | null;
  _prebuiltResultState: unknown;
  _radarPreRendered: boolean;

  // Methods
  _demoMode: { teardown(): void };
  returnToMenu(): void;
}

export class ReplayMode {
  host: IReplayModeHost;

  // Ghost management
  _replayGhosts: GhostEntry[] = [];
  _pendingGhostCreations: Array<{color: number; emissive: number; vehicleType: VehicleType}> | null = null;

  // Camera modes: 0=overhead, 1=free, 2=player, 3+=AI
  _replayCamMode: number = 0;
  _replayOrbitAngle: number = 0;
  _replayZoom: number = 1;
  _freeCamInput: FreeCamInput = {};
  _lastReplayFrame: InterpolatedReplayFrame | null = null;

  // Camera transition
  _camTransition: number = 0;
  _camTransFrom: CamTransFrom;

  // Background replay state
  _bgReplayActive: boolean = false;
  _bgReplayCamTimer: number = 0;
  _bgReplayCamInterval: number = 6;
  _bgSlowMo: boolean = false;
  _bgSlowMoT: number = 0;
  _bgDeathPos: THREE.Vector3 | null = null;
  _bgDeathColor: number | null = null;
  _bgDeathGhostIdx: number = -1;
  _bgShatter: { _stub: true } | null = null;
  _bgShatterTime: number = 0;
  _bgShatterHold: number = 0;
  _bgZoomTarget: THREE.Vector3;

  // Menu replay state
  _menuReplayActive: boolean = false;
  _menuReplayDone: (() => void) | null = null;

  /** Read-only camera mode for external callers (0=overhead, 1=free, 2=player, 3+=AI). */
  get camMode(): number { return this._replayCamMode; }

  constructor(host: IReplayModeHost) {
    this.host = host;
    this._camTransFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 };
    this._bgZoomTarget = new THREE.Vector3();
  }

  /** Handle mouse wheel zoom — routes to free cam or overhead zoom internally. */
  handleWheelZoom(deltaY: number): void {
    if (this._replayCamMode === 1) {
      if (this._freeCamInput) this._freeCamInput.zoomDelta = deltaY * 0.01;
      return;
    }
    if (this._replayCamMode !== 0) return;
    this._replayZoom = Math.max(0.5, Math.min(3.5, (this._replayZoom || 1) + deltaY * 0.001));
  }

  /** Set free cam input for this frame. Preserves zoomDelta from handleWheelZoom. */
  setFreeCamInput(input: FreeCamInput | null): void {
    if (this._replayCamMode !== 1 || !input) {
      this._freeCamInput = {};
      return;
    }
    const prevZoom = this._freeCamInput?.zoomDelta || 0;
    this._freeCamInput = input;
    if (!input.zoomDelta && prevZoom) this._freeCamInput.zoomDelta = prevZoom;
  }

  /** Apply pointer-lock mouse look deltas. Clamps pitch to +/- pi/2. */
  applyMouseLook(movementX: number, movementY: number): void {
    if (!this._freeCamInput || Object.keys(this._freeCamInput).length === 0) return;
    this.host._freeCamYaw -= movementX * 0.0012;
    this.host._freeCamPitch = Math.max(-1.5707, Math.min(1.5707,
      this.host._freeCamPitch + movementY * 0.0012));
  }

  /** Seek replay to normalized progress [0,1] and rebuild ghost trails. */
  seekTo(progress: number): void { seekToImpl(this, progress); }

  // ── Ghost management ────────────────────────────────────

  _createGhost(color: number, emissive: number, vehicleType: VehicleType = 'bike'): GhostEntry {
    return createGhost(this, color, emissive, vehicleType);
  }

  _updateGhost(ghost: GhostEntry | null, state: PlayerState | null): void {
    updateGhost(ghost, state);
  }

  _rebuildGhostTrails(seekTime: number): void { rebuildGhostTrails(this, seekTime); }

  _destroyGhosts(): void { destroyGhosts(this); }

  _findLastAlivePos(frames: ReplayFrame[], deathFrameIdx: number, type: 'player' | 'ai', aiIdx?: number): { x: number; z: number } {
    return findLastAlivePos(this, frames, deathFrameIdx, type, aiIdx);
  }

  // ── Menu replay ─────────────────────────────────────────

  startMenuReplay(snapshot: ReplaySnapshot, onDone?: () => void): void {
    this.host.cleanup();
    createArena(this.host.scene, getSelectedMap());

    this.host._replayPlayer.load(snapshot);
    this._replayGhosts = [];
    this._replayGhosts.push(this._createGhost(snapshot.playerColor, snapshot.playerEmissive || snapshot.playerColor, snapshot.playerVehicle || 'bike'));
    for (let i = 0; i < (snapshot.aiColors || []).length; i++) {
      const aiCol = snapshot.aiColors[i];
      const aiVehicle: VehicleType = snapshot.aiVehicles?.[i] || 'bike';
      const fallback = getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY);
      this._replayGhosts.push(this._createGhost(aiCol?.color ?? fallback.color, aiCol?.emissive ?? aiCol?.color ?? fallback.emissive, aiVehicle));
    }
    this._ensureBgShatterPool();
    this._menuReplayActive = true;
    this._menuReplayDone = onDone || null;
    this._bgReplayCamTimer = 0;
    this._replayCamMode = 0;
    this._replayOrbitAngle = Math.random() * Math.PI * 2;
    this._replayZoom = 1;
    this._cleanupBgShatter();
    this._resetBgSlowMo();
  }

  stopMenuReplay(): void {
    if (!this._menuReplayActive) return;
    this._cleanupBgShatter();
    this._resetBgSlowMo();
    this._destroyGhosts();
    this._replayGhosts = [];
    this.host._replayPlayer.playing = false;
    this._menuReplayActive = false;
    this._menuReplayDone = null;
  }

  // ── Full replay viewer ──────────────────────────────────

  startReplay(): void {
    if (!this.host._replayRecorder.hasData()) return;
    this.startReplayFromSnapshot(this.host._replayRecorder.getSnapshot());
  }

  async startReplayFromSnapshot(snapshot: ReplaySnapshot): Promise<void> {
    if (this.host._fading) return;
    this.host._fading = true;

    if (window.showScreen) window.showScreen(null);

    const holdDone = new Promise<void>(r => setTimeout(r, 600));
    await this.host._sceneFade(true, 'LOADING REPLAY');

    this.stopBgReplay();
    this.stopMenuReplay();
    this.host._replayPlayer.load(snapshot);

    this.host._demoMode.teardown();
    this.host.cleanup();
    createArena(this.host.scene, snapshot.mapType || getSelectedMap());

    this.host.state = 'replay';
    this._replayCamMode = 0;
    this._replayOrbitAngle = 0;
    this._replayZoom = 1;

    if (window.showScreen) window.showScreen('replay');
    else {
      document.getElementById('result')!.classList.add('hidden');
      document.getElementById('overlay')!.classList.add('hidden');
      document.getElementById('replay-overlay')!.classList.remove('hidden');
    }
    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('flow-hud')?.classList.add('menu-hidden');

    this._replayGhosts = [];
    this._replayGhosts.push(this._createGhost(snapshot.playerColor, snapshot.playerEmissive || snapshot.playerColor, snapshot.playerVehicle || 'bike'));
    for (let i = 0; i < (snapshot.aiColors || []).length; i++) {
      const aiCol = snapshot.aiColors[i];
      const aiVehicle: VehicleType = snapshot.aiVehicles?.[i] || 'bike';
      const fallback = getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY);
      this._replayGhosts.push(this._createGhost(aiCol?.color ?? fallback.color, aiCol?.emissive ?? aiCol?.color ?? fallback.emissive, aiVehicle));
    }

    resetCamera();
    this.host.camera.fov = 55;
    this.host.camera.updateProjectionMatrix();

    await holdDone;
    await this.host._sceneFade(false);
    this.host._fading = false;
  }

  _updateReplay(dt: number): void {
    const prevTime: number = this.host._replayPlayer.time;
    const frame: InterpolatedReplayFrame | null = this.host._replayPlayer.update(dt);

    if (this._replayCamMode === 1) {
      this._updateReplayCamera(dt, frame || this._lastReplayFrame!);
    }
    if (!frame) return;

    const isReverse: boolean = this.host._replayPlayer.speed < 0;
    const jumpedBack: boolean = frame.time < prevTime && !isReverse && Math.abs(prevTime - frame.time) > 0.5;
    if (jumpedBack && this.host._replayPlayer.loop) {
      this._rebuildGhostTrails(frame.time);
    }
    if (isReverse && Math.abs(prevTime - frame.time) > 0.05) {
      this._rebuildGhostTrails(frame.time);
    }

    this._lastReplayFrame = frame;

    const progressBar = document.getElementById('replay-progress-fill');
    if (progressBar) progressBar.style.width = (frame.progress * 100) + '%';

    const timeEl = document.getElementById('replay-time');
    if (timeEl) {
      const cur: number = Math.floor(frame.time);
      const total: number = Math.floor(frame.duration);
      const cm: number = Math.floor(cur / 60), cs: number = cur % 60;
      const tm: number = Math.floor(total / 60), ts: number = total % 60;
      timeEl.textContent = `${cm}:${cs.toString().padStart(2,'0')} / ${tm}:${ts.toString().padStart(2,'0')}`;
    }

    if (this.host._replayPlayer.speed > 0) {
      const allStates: PlayerState[] = [frame.player, ...frame.ais];
      for (let i = 0; i < allStates.length; i++) {
        const ghost: GhostEntry | undefined = this._replayGhosts[i];
        if (ghost && ghost.alive && !allStates[i].alive) {
          this.host._replayPlayer.playing = false;
          const who: string = i === 0 ? 'PLAYER' : 'OPPONENT ' + i;
          document.getElementById('replay-status')!.textContent = who + ' ELIMINATED';
          document.getElementById('btn-replay-play')!.innerHTML = '<svg class="icon"><use href="/icons.svg#i-play"/></svg>';
          break;
        }
      }
    }

    if (this._replayGhosts.length > 0) {
      this._updateGhost(this._replayGhosts[0], frame.player);
    }
    for (let i = 0; i < frame.ais.length; i++) {
      if (this._replayGhosts[i + 1]) {
        this._updateGhost(this._replayGhosts[i + 1], frame.ais[i]);
      }
    }

    this._updateReplayCamera(dt, frame);

    if (this.host._replayPlayer.isFinished()) {
      document.getElementById('replay-status')!.textContent = 'REPLAY ENDED';
      document.getElementById('btn-replay-play')!.innerHTML = '<svg class="icon"><use href="/icons.svg#i-play"/></svg>';
      document.getElementById('btn-replay-restart')!.classList.remove('hidden');
    }
  }

  _updateReplayCamera(dt: number, frame: InterpolatedReplayFrame): void {
    updateReplayCamera(this, dt, frame);
  }

  cycleReplayCamera(dir: number = 1): void {
    if (!this.host._replayPlayer.data) return;
    this._camTransFrom.pos.copy(this.host.camera.position);
    const lookDir = new THREE.Vector3();
    this.host.camera.getWorldDirection(lookDir);
    this._camTransFrom.target.copy(this.host.camera.position).add(lookDir);
    this._camTransFrom.fov = this.host.camera.fov;
    this._camTransition = 0.4;

    const totalCams: number = 2 + 1 + this.host._replayPlayer.data.aiColors.length;
    this._replayCamMode = ((this._replayCamMode + dir) % totalCams + totalCams) % totalCams;
    if (this._replayCamMode === 1) {
      this.host._freeCamPos.copy(this.host.camera.position);
      const dir2 = new THREE.Vector3();
      this.host.camera.getWorldDirection(dir2);
      this.host._freeCamYaw = Math.atan2(dir2.x, dir2.z);
      this.host._freeCamPitch = -Math.asin(dir2.y);
      this.host._freeCamVel.set(0, 0, 0);
    }
    resetCamera();
    this._updateReplayCamLabel();
  }

  _updateReplayCamLabel(): void {
    const label = document.getElementById('replay-cam-val');
    if (label) {
      if (this._replayCamMode === 0) label.textContent = 'OVERHEAD';
      else if (this._replayCamMode === 1) label.textContent = 'FREE CAM';
      else if (this._replayCamMode === 2) label.textContent = 'PLAYER';
      else label.textContent = 'OPPONENT ' + (this._replayCamMode - 2);
    }
  }

  stopReplay(): void {
    this._destroyGhosts();
    this.host._replayPlayer.playing = false;
    this._replayCamMode = 0;
    document.getElementById('replay-overlay')!.classList.add('hidden');
  }

  exitReplayToMenu(): void {
    this.stopReplay();
    this.host.returnToMenu();
  }

  async exitReplayToResults(): Promise<void> {
    if (this.host._fading) return;
    this.host._fading = true;
    try {
      const holdDone = new Promise<void>(r => setTimeout(r, 600));
      await this.host._sceneFade(true, 'LOADING');
      this.stopReplay();
      this.host.cleanup();
      this.host.state = 'gameover';
      this.host.gameOverTimer = 2;
      if (window.showScreen) window.showScreen('gameover');
      else document.getElementById('result')!.classList.remove('hidden');
      document.documentElement.style.setProperty('--topbar-offset', '40px');
      document.getElementById('meter-wrap')!.classList.add('menu-hidden');
      document.getElementById('flow-hud')?.classList.add('menu-hidden');
      document.getElementById('replay-status')!.textContent = 'REPLAY';
      await holdDone;
      await this.host._sceneFade(false);
      if (window._showTopBar) window._showTopBar();
    } finally {
      this.host._fading = false;
      document.getElementById('scene-fade')!.classList.remove('scene-fade--active');
    }
  }

  // ── Background replay (plays behind victory screen) ────

  async startBgReplay(): Promise<void> {
    if (!this.host._replayRecorder.hasData()) return;
    const snapshot: ReplaySnapshot = this.host._replayRecorder.getSnapshot();
    this.host._replayPlayer.load(snapshot);

    const toDestroy: Player[] = [];
    if (this.host.player) {
      this.host.player.mesh.visible = false;
      if (this.host.player.bikeLight) this.host.player.bikeLight.intensity = 0;
      if (this.host.player.underGlow) this.host.player.underGlow.intensity = 0;
      if (this.host.player.proximityAura) this.host.player.proximityAura.intensity = 0;
      toDestroy.push(this.host.player);
      this.host.player = null;
    }
    for (const ai of this.host.ais) {
      ai.player.mesh.visible = false;
      if (ai.player.bikeLight) ai.player.bikeLight.intensity = 0;
      if (ai.player.underGlow) ai.player.underGlow.intensity = 0;
      toDestroy.push(ai.player);
    }
    this.host.ais = [];
    if (toDestroy.length) requestAnimationFrame(() => { for (const p of toDestroy) p.destroy(); });

    this._replayGhosts = [];
    if (this.host._prebuiltPlayerGhost) {
      (this.host._prebuiltPlayerGhost as GhostEntry).mesh.visible = true;
      this._replayGhosts.push(this.host._prebuiltPlayerGhost as GhostEntry);
      this.host._prebuiltPlayerGhost = null;
    } else {
      this._replayGhosts.push(this._createGhost(snapshot.playerColor, snapshot.playerEmissive || snapshot.playerColor, snapshot.playerVehicle || 'bike'));
    }

    if (!this._bgShatter) this._ensureBgShatterPool();
    this._bgReplayActive = true;
    this._bgReplayCamTimer = 0;
    this._replayCamMode = 0;
    this._replayOrbitAngle = 0;
    this._replayZoom = 1;
    this._cleanupBgShatter();
    this._resetBgSlowMo();

    const aiColors = snapshot.aiColors || [];
    if (aiColors.length > 0) {
      const fallback = getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY);
      this._pendingGhostCreations = aiColors.map((aiCol, i) => ({
        color: aiCol?.color ?? fallback.color,
        emissive: aiCol?.emissive ?? aiCol?.color ?? fallback.emissive,
        vehicleType: (snapshot.aiVehicles?.[i] || 'bike') as VehicleType,
      }));
      while (this._pendingGhostCreations?.length && this._bgReplayActive) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!this._pendingGhostCreations?.length || !this._bgReplayActive) break;
        const spec = this._pendingGhostCreations.shift()!;
        this._replayGhosts.push(this._createGhost(spec.color, spec.emissive, spec.vehicleType));
      }
      this._pendingGhostCreations = null;
    }
  }

  stopBgReplay(): void {
    if (!this._bgReplayActive) return;
    this._pendingGhostCreations = null;
    this._cleanupBgShatter();
    this._resetBgSlowMo();
    this._destroyGhosts();
    this.host._replayPlayer.playing = false;
    this._bgReplayActive = false;
    this._resetPrepState();
  }

  _resetPrepState(): void {
    if (this.host._prebuiltPlayerGhost) {
      (this.host._prebuiltPlayerGhost as GhostEntry).trail.destroy();
      this.host.scene.remove((this.host._prebuiltPlayerGhost as GhostEntry).mesh);
      this.host._prebuiltPlayerGhost = null;
    }
    this.host._prepDone = false;
    this.host._prebuiltResultState = null;
    this.host._radarPreRendered = false;
  }

  _updateBgReplay(dt: number): void { updateBgReplay(this, dt); }
  _updateMenuReplay(dt: number): void { updateBgReplay(this, dt); }
  _updateBgDeathCamera(dt: number): void { updateBgDeathCamera(this, dt); }
  _ensureBgShatterPool(): void { ensureBgShatterPool(this); }
  _spawnBgShatter(pos: THREE.Vector3, color: number): void { spawnBgShatter(this, pos, color); }
  _updateBgShatter(dt: number): void { updateBgShatter(this, dt); }
  _cleanupBgShatter(): void { cleanupBgShatter(this); }
  _resetBgSlowMo(): void { resetBgSlowMo(this); }
  _loopBgReplay(): void { loopBgReplay(this); }
}
