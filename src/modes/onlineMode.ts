// ── Online Mode ──────────────────────────────────────────
// Extracted from game.ts — online match init, waiting-for-opponent,
// countdown bridge, and teardown. Per-tick lockstep logic lives in
// onlineLockstepTick.ts; shared helpers in onlineModeHelpers.ts.

import { Player } from '../player';
import { createArena } from '../grid';
import { getAIInput, createAIState } from '../ai';
import { PLAYER_COLOR_KEYS } from '../playerColors';
import { resetCamera } from '../scene';
import { getVehiclePhysics } from '../vehicleConfig';
import { seededRandom } from '../core/seededRandom';
import { TOUCH_ENABLED } from '../input';
import { setTouchVehicle } from '../touch';
import { setTouchButtonVehicle } from '../touchButtons';
import { getSelectedMap } from '../ui/mapSelectUI';
import { hideStreakDisplay } from '../ui/streakUI';
import { net } from '../netLog';
import type { OnlineMatch } from '../onlineMatch';
import type { Trail } from '../trail';
import type { AIInput, VehicleType, RemoteState } from '../types/index';
import * as THREE from 'three';

import type { IOnlineModeHost } from './onlineModeTypes';
import { updateLockstepTick as _updateLockstepTickImpl } from './onlineLockstepTick';
import { buildLockstepManager as _buildLockstepManager } from './onlineLockstepSetup';

export type { IOnlineModeHost } from './onlineModeTypes';

export class OnlineMode {
  private host: IOnlineModeHost;

  constructor(host: IOnlineModeHost) {
    this.host = host;
  }

  startOnlineMatch(onlineMatch: OnlineMatch): void {
    if (this.host._fading) return;
    this.host._fading = true;
    this.host._refreshPlayerColor();
    // Stop background replay / menu replay if active
    this.host.stopBgReplay();
    this.host.stopMenuReplay();

    // Clear radar immediately so old trails don't flash
    if (this.host._radarCtx) {
      const s: number = this.host._radarCtx.canvas.width;
      this.host._radarCtx.clearRect(0, 0, s, s);
    }

    // Save current camera state for transition
    this.host._transitionCamStart = this.host.camera.position.clone();
    this.host._transitionFovStart = this.host.camera.fov;

    // Hide HUD elements during fade (same as local startCountdown)
    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('flow-hud')?.classList.add('menu-hidden');
    document.getElementById('radar')!.classList.add('hidden');
    document.getElementById('match-timer')!.classList.add('hidden');
    document.getElementById('countdown')!.classList.add('hidden');

    // Fade to black, then rebuild scene behind the fade
    this.host._sceneFade(true, 'ENTERING MATCH').then(async () => {
      const holdDone = new Promise<void>(r => setTimeout(r, 600));
      // Clean up demo
      this.host._demoMode.teardown();

      this.host.cleanup();
      createArena(this.host.scene, getSelectedMap());


      this.host.mode = 'online';
      this.host._onlineMatch = onlineMatch;

      // ── N-player spawn + index assignment ──
      const allSpawns = onlineMatch.getSpawns();
      const allUids: string[] = [...onlineMatch.allPlayerUids].sort();
      const myIndex: number = allUids.indexOf(onlineMatch.myUid);
      const humanCount: number = allUids.length;
      this.host._lockstepMyIndex = myIndex;
      this.host._lockstepHumanCount = humanCount;
      this.host._lockstepAiStates = [];

      const onlinePlayerVehicle: VehicleType = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
      if (TOUCH_ENABLED) { setTouchVehicle(onlinePlayerVehicle); setTouchButtonVehicle(onlinePlayerVehicle); }

      // Build vehicle configs in sorted UID order
      const cfgs = allUids.map(uid => {
        if (uid === onlineMatch.myUid) return getVehiclePhysics(onlinePlayerVehicle);
        const opp = onlineMatch.opponents.find(o => o.uid === uid);
        return getVehiclePhysics((opp?.vehicle || 'bike') as VehicleType);
      });

      _seedReplayRecorder(this.host, onlineMatch, allUids, myIndex, humanCount, onlinePlayerVehicle);
      _spawnHumanPlayers(this.host, onlineMatch, allSpawns, allUids, myIndex, humanCount, onlinePlayerVehicle);

      // ── BUG-18 diagnostic: verify both players created with geometry ──
      if (import.meta.env.DEV) {
        _logBug18Spawn(this.host, onlinePlayerVehicle);
      }

      _spawnLobbyAiBots(this.host, onlineMatch, allSpawns, humanCount);

      // ── Lockstep setup (negotiated during accept handshake) ──
      if (onlineMatch.useLockstep) {
        _buildLockstepManager(this.host, onlineMatch, allSpawns, allUids, cfgs, humanCount, myIndex);
      } else {
        this.host._lockstep = null;
      }

      // Warm trail shaders during transition (behind black fade) to avoid compile stutter
      this.host.player!.trail.warmShaders();
      for (const ai of this.host.ais) {
        ai.player.trail.warmShaders();
      }

      resetCamera();
      this.host._victoryFireworks = false;

      _resetOverlaysAndHUD();

      // Enter transition state — smooth camera sweep before countdown (same as local)
      this.host.state = 'transition';
      this.host._transitionTimer = 0;
      this.host._transitionDuration = 1.2;
      this.host.matchTime = 0;

      // Fade from black — reveal the fresh scene
      this.host._fading = false;
      await holdDone;
      this.host._sceneFade(false);
    });
  }

  _beginWaitingForOpponent(): void {
    this.host.state = 'waitingOnline';

    // Apply adaptive input delay from RTT + previous-round delivery telemetry
    if (this.host._lockstep && this.host._onlineMatch) {
      const rtt = this.host._onlineMatch.netcode.estimatedRttMs;
      const delay = this.host._delayAdvisor.recommend(rtt);
      this.host._lockstep.setInputDelay(delay);
    }

    // Show small top-left connecting spinner instead of hijacking countdown
    document.getElementById('connecting-spinner')!.classList.remove('hidden');

    // Hide streak HUD during pre-match (it shows on result screen instead)
    hideStreakDisplay();

    // Signal that our scene is loaded — OnlineMatch will fire 'bothLoaded' when opponent is ready too
    this.host._onlineMatch!.signalLoaded().catch((err: unknown) => {
      net.error('signalLoaded failed:', err);
      this._retrySignalLoaded(3, 1500);
    });
  }

  private _retrySignalLoaded(remaining: number, delay: number): void {
    if (remaining <= 0 || this.host.state !== 'waitingOnline') return;
    setTimeout(() => {
      if (this.host.state !== 'waitingOnline') return;
      this.host._onlineMatch?.signalLoaded().catch(() => {
        this._retrySignalLoaded(remaining - 1, Math.round(delay * 1.5));
      });
    }, delay);
  }

  // Called when both online players have loaded — start the real countdown
  beginOnlineCountdown(): void {
    // Hide the connecting spinner
    document.getElementById('connecting-spinner')!.classList.add('hidden');
    this.host._beginCountdown();
  }

  /** Tear down online match state — stops netcode, clears listeners, hides disconnect UI. */
  _teardownOnline(): void {
    if (this.host._onlineMatch) {
      this.host._onlineMatch.stop();
      this.host._onlineMatch = null;
    }
    this.host._lockstep = null;
    this.host.mode = 'local';
    const banner = document.getElementById('disconnect-banner');
    if (banner) banner.classList.add('hidden');
  }

  // ── Extracted update() helpers ─────────────────────────────

  /**
   * Block 1: Lockstep tick — sim tick, apply states, SFX reactions,
   * AI update (non-lockstep fallback) + AI collision + human-vs-AI collision.
   *
   * Implementation lives in onlineLockstepTick.ts (timing-critical; see module header).
   */
  updateLockstepTick(dt: number, turnDir: number, allTrails: Trail[]): void {
    _updateLockstepTickImpl(this.host, dt, turnDir, allTrails);
  }

  /**
   * Block 2: Non-lockstep online sync — state streaming and online lobby AI update.
   */
  updateOnlineSync(dt: number, allTrails: Trail[]): void {
    const host = this.host;
    const onlineMatch = host._onlineMatch!;

    // ── Online: sync via netcode instead of AI ──
    // Update death grace window + sample peak predict-ahead (~every second)
    if (Math.floor(host.matchTime) !== Math.floor(host.matchTime - dt)) {
      onlineMatch.updateGraceFromRtt();
      onlineMatch.samplePredictAhead();
    }
    // State streaming (position sync) — only active when lockstep is OFF.
    // When lockstep is ON, opponent state comes from the deterministic simulation.
    if (!onlineMatch.useLockstep) {
      const nc = onlineMatch.netcode;
      nc.sendState(
        dt,
        host.player!.mesh.position.x, host.player!.mesh.position.z,
        host.player!.angle, host.player!.speed, host.player!.meter,
        host.player!.alive, host.player!.boosting, host.player!.dashing
      );

      // Update all remote human players from network (N-player state-streaming support)
      for (const ai of host.ais) {
        if (!ai.uid || ai.aiState) continue; // lobby AI bots are updated below; skip them
        const remote: RemoteState | null = nc.getRemoteState(ai.uid, dt);
        if (remote) {
          ai.player.mesh.position.x = remote.x;
          ai.player.mesh.position.z = remote.z;
          ai.player.angle = remote.angle;
          ai.player.mesh.rotation.y = remote.angle;
          ai.player.speed = remote.speed;
          ai.player.boosting = remote.boosting;
          ai.player.dashing = remote.dashing;
          ai.player.alive = remote.alive;
          ai.player.trailTimer = (ai.player.trailTimer || 0) + dt;
          if (ai.player.trailTimer > 0.02) {
            ai.player.trailTimer = 0;
            ai.player.trail.addPoint(remote.x, remote.z);
          }
          ai.player.trail.updateHead(remote.x, remote.z);
          ai.player.trail.updateSpeed(remote.speed / 40);
        } else {
          // No remote data yet — still update trail at spawn so it renders
          const ox: number = ai.player.mesh.position.x;
          const oz: number = ai.player.mesh.position.z;
          ai.player.trail.updateHead(ox, oz);
        }
      }
    }

    // ── Online lobby AIs: update locally (both clients compute identically) ──
    if (onlineMatch.lobbyAis) {
      host._aiFrame = (host._aiFrame || 0) + 1;
      for (let idx = 0; idx < host.ais.length; idx++) { // aiState null check below skips remote humans
        const ai = host.ais[idx];
        if (ai.player.alive && ai.aiState) {
          if (host._aiFrame % 3 === idx % 3) {
            const aiInput: AIInput = getAIInput(ai.player, allTrails, dt, ai.aiState, host.player!.trail, ai.player.trail);
            ai._lastInput = aiInput;
          }
          const input: AIInput = ai._lastInput || { turn: 0, accelerate: false, dash: false, brake: false };
          ai.player.update(dt, input.turn, input.accelerate, input.dash, input.brake);
        }
      }
    }
  }

  /**
   * Block 3: Apply visual smoothing offsets from lockstep rollback corrections
   * after camera update.
   */
  applyVisualOffsets(): void {
    const host = this.host;
    const lockstep = host._lockstep!;

    const myOff = lockstep.myVisualOffset;
    if (myOff.x !== 0 || myOff.z !== 0) {
      host.player!.mesh.position.x += myOff.x;
      host.player!.mesh.position.z += myOff.z;
    }
    // Apply visual smoothing to all remote human players
    let rOffIdx = 0;
    for (let i = 0; i < host._lockstepHumanCount; i++) {
      if (i === host._lockstepMyIndex) continue;
      const off = lockstep.getVisualOffset(i);
      if (off.x !== 0 || off.z !== 0) {
        const aiEntry = host.ais[rOffIdx];
        if (aiEntry && !aiEntry.aiState) {
          aiEntry.player.mesh.position.x += off.x;
          aiEntry.player.mesh.position.z += off.z;
        }
      }
      rOffIdx++;
    }
  }
}

// ── startOnlineMatch phase helpers ───────────────────────

/** Seed the replay recorder with colors/vehicles for all opponents. */
function _seedReplayRecorder(
  host: IOnlineModeHost,
  onlineMatch: OnlineMatch,
  allUids: string[],
  myIndex: number,
  humanCount: number,
  onlinePlayerVehicle: VehicleType,
): void {
  const oppColors: { color: number; emissive: number }[] = [];
  const oppVehicles: VehicleType[] = [];
  for (let i = 0; i < humanCount; i++) {
    if (i === myIndex) continue;
    const uid = allUids[i];
    const opp = onlineMatch.opponents.find(o => o.uid === uid);
    const colorKey: string = String(opp?.color || 'red');
    const colorEntry = host._colorMap[colorKey] || host._colorMap.red;
    // TASK-267: shift opponent render color so two players who both picked
    // the same colour aren't indistinguishable on the local screen.
    const resolved = _resolveOpponentColor(host, colorEntry.color, colorEntry.emissive);
    oppColors.push(resolved);
    oppVehicles.push((opp?.vehicle || 'bike') as VehicleType);
  }
  host._replayRecorder.reset(host.playerColor, host.playerEmissive, oppColors, onlinePlayerVehicle, oppVehicles);
}

/** TASK-267: pick the first palette colour that differs from the local
 *  player. Symmetric across clients — each side sees the collision and
 *  locally swaps their opponent to the first non-matching palette entry. */
function _resolveOpponentColor(
  host: IOnlineModeHost,
  oppColor: number,
  oppEmissive: number,
): { color: number; emissive: number } {
  if (oppColor !== host.playerColor) return { color: oppColor, emissive: oppEmissive };
  for (const key of PLAYER_COLOR_KEYS) {
    const entry = host._colorMap[key];
    if (entry && entry.color !== host.playerColor) {
      return { color: entry.color, emissive: entry.emissive };
    }
  }
  return { color: oppColor, emissive: oppEmissive };
}

/** Create the local Player and remote human Players. Populates host.ais[]. */
function _spawnHumanPlayers(
  host: IOnlineModeHost,
  onlineMatch: OnlineMatch,
  allSpawns: ReturnType<OnlineMatch['getSpawns']>,
  allUids: string[],
  myIndex: number,
  humanCount: number,
  onlinePlayerVehicle: VehicleType,
): void {
  // Create local player at sorted index position
  const mySpawn = allSpawns[myIndex];
  host.player = new Player(host.scene, {
    color: host.playerColor,
    emissive: host.playerEmissive,
    startX: mySpawn.x,
    startZ: mySpawn.z,
    startAngle: mySpawn.angle,
    vehicleType: onlinePlayerVehicle,
  });

  // Create ALL remote human players and push to host.ais[]
  host.ais = [];
  host.opponent = null;
  for (let i = 0; i < humanCount; i++) {
    if (i === myIndex) continue;
    const spawn = allSpawns[i];
    const uid = allUids[i];
    const opp = onlineMatch.opponents.find(o => o.uid === uid);
    const colorKey: string = String(opp?.color || 'red');
    const colorEntry = host._colorMap[colorKey] || host._colorMap.red;
    // TASK-267: defuse same-color collision before the Player mesh is built
    // so the trail/vehicle shader pick up the shifted hues.
    const resolved = _resolveOpponentColor(host, colorEntry.color, colorEntry.emissive);
    const oppVehicle = (opp?.vehicle || 'bike') as VehicleType;
    const remotePlayer = new Player(host.scene, {
      color: resolved.color,
      emissive: resolved.emissive,
      startX: spawn.x,
      startZ: spawn.z,
      startAngle: spawn.angle,
      isAI: true,
      vehicleType: oppVehicle,
    });
    // First remote player also set as host.opponent for backward compat
    if (!host.opponent) host.opponent = remotePlayer;
    host.ais.push({ player: remotePlayer, aiState: null, colorHex: resolved.color, uid });
  }
}

/** BUG-18: dev-only diagnostics for verifying player meshes/positions post-spawn. */
function _logBug18Spawn(host: IOnlineModeHost, onlinePlayerVehicle: VehicleType): void {
  const _countMeshes = (g: THREE.Object3D): number => {
    let n = 0;
    g.traverse((c: THREE.Object3D) => { if ((c as THREE.Mesh).isMesh) n++; });
    return n;
  };
  const localMeshes = _countMeshes(host.player!.mesh);
  const localPos = host.player!.mesh.position;
  net.warn(`[BUG-18] local player: meshes=${localMeshes} pos=(${localPos.x.toFixed(1)}, ${localPos.z.toFixed(1)}) vehicle=${onlinePlayerVehicle}`);
  for (let ri = 0; ri < host.ais.length; ri++) {
    const ai = host.ais[ri];
    const rm = _countMeshes(ai.player.mesh);
    const rp = ai.player.mesh.position;
    const inScene = !!ai.player.mesh.parent;
    net.warn(`[BUG-18] remote[${ri}]: meshes=${rm} pos=(${rp.x.toFixed(1)}, ${rp.z.toFixed(1)}) vehicle=${ai.player.vehicleType} inScene=${inScene} isAI=${ai.player.isAI}`);
    if (rm === 0) {
      net.error(`[BUG-18] REMOTE PLAYER HAS ZERO MESHES — vehicle model not loaded! vehicle=${ai.player.vehicleType}`);
    }
  }
}

/** Spawn lobby AI bots (both clients do this identically). */
function _spawnLobbyAiBots(
  host: IOnlineModeHost,
  onlineMatch: OnlineMatch,
  allSpawns: ReturnType<OnlineMatch['getSpawns']>,
  humanCount: number,
): void {
  if (!onlineMatch.lobbyAis) return;
  const aiEntries = Object.entries(onlineMatch.lobbyAis).sort(([a], [b]) => Number(a) - Number(b));
  for (let i = 0; i < aiEntries.length; i++) {
    const [, aiData] = aiEntries[i];
    const aiSpawn = allSpawns[humanCount + i];
    const aiColorEntry = host._colorMap[aiData.color] || host._colorMap.red;
    const aiVehicle = (aiData.vehicle || 'bike') as VehicleType;
    const aiPlayer = new Player(host.scene, {
      color: aiColorEntry.color,
      emissive: aiColorEntry.emissive,
      startX: aiSpawn.x,
      startZ: aiSpawn.z,
      startAngle: aiSpawn.angle,
      isAI: true,
      vehicleType: aiVehicle,
    });
    // Seeded AI state: derive per-AI seed deterministically from match seed
    const aiSeed = onlineMatch.seed ^ ((i + 1) * 0x9e3779b9);
    const aiState = createAIState(seededRandom(aiSeed), 'medium');
    host.ais.push({ player: aiPlayer, aiState, colorHex: aiColorEntry.color });
  }
  onlineMatch.totalEntityCount = humanCount + aiEntries.length;
}

/** Hide overlays/HUD elements + reset radar position for a fresh match. */
function _resetOverlaysAndHUD(): void {
  // Hide all overlay screens instantly (behind the black fade)
  document.querySelectorAll('.overlay-screen').forEach((el: Element) => {
    (el as HTMLElement).classList.add('hidden');
    (el as HTMLElement).style.transition = '';
    (el as HTMLElement).style.opacity = '';
    (el as HTMLElement).style.pointerEvents = '';
  });
  ['pause-overlay', 'replay-overlay', 'result', 'series-result'].forEach((id: string) => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.style.transition = ''; el.style.opacity = ''; el.style.pointerEvents = ''; }
  });
  document.getElementById('series-result')!.classList.add('hidden');
  document.getElementById('bottom-bar')!.classList.add('hidden');

  // Reset radar position and timer for fresh match
  const radarWrap = document.getElementById('radar-wrap');
  if (radarWrap) {
    radarWrap.style.left = '';
    radarWrap.style.top = '';
    radarWrap.style.right = '';
  }
  const matchTimer = document.getElementById('match-timer');
  if (matchTimer) matchTimer.textContent = '0:00';
}
