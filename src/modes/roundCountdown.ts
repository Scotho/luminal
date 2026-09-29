// ── Round Countdown ──────────────────────────────────────
// Extracted from roundFlow.ts — startCountdown orchestration.
// Pure extraction, no behavioral changes. State is passed via host.

import { Player } from '../player';
import { createArena, ARENA_SIZE } from '../grid';
import { createAIState } from '../ai';
import { TOUCH_ENABLED } from '../input';
import { setTouchVehicle } from '../touch';
import { getCtx } from '../sfx';
import { preloadVehicleAudio } from '../vehicleSfxLoader';
import { initListener, createOpponentAudio, startOpponentEngine } from '../spatialAudio';
import { warnDev } from '../swallow';
import { preloadSfx } from '../sfxAssets';
import { getSelectedMap } from '../ui/mapSelectUI';
import { hideResultMapPanel } from '../ui/resultMapSelect';
import { getSelectedDifficulty } from '../ui/difficultySelectUI';
import type { VehicleType } from '../types/index';
import type { IRoundFlowHost } from './roundFlow';

/**
 * Pick vehicles for the player and AIs, reset the replay recorder,
 * and kick off non-blocking vehicle audio preloads. Returns the
 * chosen vehicles so the caller can spawn actors with them.
 */
function pickMatchVehicles(host: IRoundFlowHost): { playerVehicle: VehicleType; aiVehicles: VehicleType[] } {
  const playerVehicle: VehicleType = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
  if (TOUCH_ENABLED) setTouchVehicle(playerVehicle);
  const vehiclePool: VehicleType[] = ['bike', 'car'];
  const aiVehicles: VehicleType[] = host._seriesAiVehicles.length > 0
    ? host._seriesAiVehicles
    : Array.from({ length: host.opponentCount }, () => vehiclePool[Math.floor(Math.random() * vehiclePool.length)]);
  host._replayRecorder.reset(host.playerColor, host.playerEmissive, host._seriesAiColors, playerVehicle, aiVehicles);

  // Preload vehicle audio samples (non-blocking)
  const vehicleTypes = new Set<VehicleType>([playerVehicle, ...aiVehicles]);
  for (const vt of vehicleTypes) {
    preloadVehicleAudio(vt).catch(() => {}); // non-blocking
  }
  return { playerVehicle, aiVehicles };
}

/**
 * Spawn the player and all AI opponents around the arena center,
 * wire up per-AI spatial audio, and warm trail shaders behind the
 * blackout.
 */
function spawnPlayerAndAIs(host: IRoundFlowHost, playerVehicle: VehicleType, aiVehicles: VehicleType[]): void {
  // Spawn positions distributed around center, facing inward
  const totalPlayers: number = 1 + host.opponentCount;
  const halfArena: number = ARENA_SIZE / 2;
  const minDist: number = halfArena * 0.42;
  const maxDist: number = halfArena * 0.75;
  const angleStep: number = (Math.PI * 2) / totalPlayers;
  const baseAngle: number = Math.random() * Math.PI * 2;

  const playerDist: number = minDist + Math.random() * (maxDist - minDist);
  const px: number = Math.cos(baseAngle) * playerDist;
  const pz: number = Math.sin(baseAngle) * playerDist;
  host.player = new Player(host.scene, {
    color: host.playerColor,
    emissive: host.playerEmissive,
    startX: px,
    startZ: pz,
    startAngle: Math.atan2(px, pz),
    vehicleType: playerVehicle,
  });

  host.ais = [];
  try { initListener(getCtx()); } catch (e) { warnDev('roundFlow', e); }
  const aiStartOffset = 1;
  for (let i = 0; i < host.opponentCount; i++) {
    const { color, emissive } = host._seriesAiColors[i];
    const spawnAngle: number = baseAngle + angleStep * (i + aiStartOffset);
    const aiDist: number = minDist + Math.random() * (maxDist - minDist);
    const ax: number = Math.cos(spawnAngle) * aiDist;
    const az: number = Math.sin(spawnAngle) * aiDist;
    const aiVehicleType: VehicleType = aiVehicles[i] || 'bike';
    const ai = new Player(host.scene, {
      color,
      emissive,
      startX: ax,
      startZ: az,
      startAngle: Math.atan2(ax, az),
      isAI: true,
      vehicleType: aiVehicleType,
    });
    host.ais.push({ player: ai, aiState: createAIState(undefined, getSelectedDifficulty()), colorHex: color });
    try {
      const ctx = getCtx();
      createOpponentAudio(`ai-${i}`, ctx);
      startOpponentEngine(`ai-${i}`, aiVehicleType);
    } catch (e) { warnDev('roundFlow', e); }
  }

  // Warm trail shaders during transition (behind black fade) to avoid compile stutter
  host.player.trail.warmShaders();
  for (const ai of host.ais) ai.player.trail.warmShaders();
}

/** Clear overlay screens and reset HUD elements behind the blackout. */
function resetOverlaysAndHUD(host: IRoundFlowHost): void {
  host._victoryFireworks = false;
  host._spectating = false;
  host._spectateTarget = null;
  host._spectateCamState = null;
  const specLabel = document.getElementById('spectator-label');
  if (specLabel) specLabel.classList.add('hidden');
  host._updateStreak();

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
  host._updateSeriesHUD();
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

/**
 * Rebuild the scene, spawn player + AIs, and reset HUD elements
 * behind the scene-fade blackout. Called from startCountdown after
 * the fade-to-black completes.
 */
async function buildMatchScene(host: IRoundFlowHost): Promise<void> {
  const holdDone = new Promise<void>(r => setTimeout(r, 600));

  // Stop bg/menu replay behind the black screen to avoid visible ghost destruction stutter
  host.stopBgReplay();
  host._resetPrepState();
  host.stopMenuReplay();

  // Clean up demo
  host._demoMode.teardown();

  host.cleanup();
  createArena(host.scene, getSelectedMap());

  const { playerVehicle, aiVehicles } = pickMatchVehicles(host);
  spawnPlayerAndAIs(host, playerVehicle, aiVehicles);
  resetOverlaysAndHUD(host);

  // Enter transition state — smooth camera sweep before countdown
  host.state = 'transition';
  host._transitionTimer = 0;
  host._transitionDuration = 1.2;
  host.matchTime = 0;

  // Fade from black — reveal the fresh scene
  host._fading = false;
  await holdDone;
  host._sceneFade(false);
}

/**
 * Entry point for the countdown flow. Fades to black, rebuilds the
 * scene, and begins the transition camera sweep that will eventually
 * call beginCountdown.
 */
export function startCountdown(host: IRoundFlowHost): void {
  if (host._fading) return; // prevent double-trigger during fade
  host._fading = true;
  hideResultMapPanel();
  host._refreshPlayerColor();
  preloadSfx();

  // Clear radar immediately so old trails don't flash
  if (host._radarCtx) {
    const s: number = host._radarCtx.canvas.width;
    host._radarCtx.clearRect(0, 0, s, s);
  }

  // Save current camera state for transition
  host._transitionCamStart = host.camera.position.clone();
  host._transitionFovStart = host.camera.fov;

  // Hide HUD elements (these now use opacity transitions)
  document.getElementById('meter-wrap')!.classList.add('menu-hidden');
  document.getElementById('flow-hud')?.classList.add('menu-hidden');
  document.getElementById('radar')!.classList.add('hidden');
  document.getElementById('match-timer')!.classList.add('hidden');
  document.getElementById('countdown')!.classList.add('hidden');

  // Fade to black, then rebuild scene behind the fade
  host._sceneFade(true, 'ENTERING MATCH').then(() => buildMatchScene(host));
}
