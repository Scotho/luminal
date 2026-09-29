// ── Proximity Audio Engine ──────────────────────────────
// Spatial audio via Web Audio PannerNode (HRTF).
// Local player audio stays centered; opponents are spatialized.

import * as THREE from 'three';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from './sfxContext';
import { warnDev } from './swallow';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import { ProceduralEngine } from './engineStrategyProcedural';
import { SweepEngine } from './engineStrategySweep';
import { RpmBandEngine } from './engineStrategyRpmBand';
import type { VehicleType, VehicleAudioProfile } from './types/index';

// ── Sound Range Tiers (central config) ──────────────────
// All range tuning lives here. To add a new sound, assign it a tier.
// ARENA_SIZE = 384: quarter = 96, half = 192, full = 384.
export enum SoundRange {
  SHORT  = 0, // engines, swooshes, sputters, sparks
  MEDIUM = 1, // boosts, dashes, drifts
  LONG   = 2, // explosions, taunts
}

export const RANGE_CONFIG: Record<SoundRange, {
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
}> = {
  [SoundRange.SHORT]:  { refDistance: 10, maxDistance: 96,  rolloffFactor: 1.5 },
  [SoundRange.MEDIUM]: { refDistance: 20, maxDistance: 192, rolloffFactor: 1.2 },
  [SoundRange.LONG]:   { refDistance: 30, maxDistance: 384, rolloffFactor: 1.0 },
};

// ── Listener ────────────────────────────────────────────
let _listener: AudioListener | null = null;
const _fwd = new THREE.Vector3();

export function initListener(ctx: AudioContext): void {
  _listener = ctx.listener;
}

export function updateListener(camera: THREE.PerspectiveCamera): void {
  if (!_listener) return;
  const p = camera.position;
  camera.getWorldDirection(_fwd);
  _listener.positionX.value = p.x;
  _listener.positionY.value = p.y;
  _listener.positionZ.value = p.z;
  _listener.forwardX.value = _fwd.x;
  _listener.forwardY.value = _fwd.y;
  _listener.forwardZ.value = _fwd.z;
  _listener.upX.value = 0;
  _listener.upY.value = 1;
  _listener.upZ.value = 0;
}

// ── Opponent Audio Registry ─────────────────────────────
interface OpponentGrindNodes {
  noise: AudioBufferSourceNode;
  bp: BiquadFilterNode;
  gain: GainNode;
  hum: OscillatorNode;
  humGain: GainNode;
}

interface OpponentAudio {
  id: string;
  panners: Record<SoundRange, PannerNode>;
  alive: boolean;
  grindNodes: OpponentGrindNodes | null;
  grindActive: boolean;
}

const _opponents: Map<string, OpponentAudio> = new Map();

function createPanner(ctx: AudioContext, range: SoundRange): PannerNode {
  const cfg = RANGE_CONFIG[range];
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = cfg.refDistance;
  p.maxDistance = cfg.maxDistance;
  p.rolloffFactor = cfg.rolloffFactor;
  p.coneInnerAngle = 360;
  p.coneOuterAngle = 360;
  p.connect(getSfxOutput(ctx));
  return p;
}

export function createOpponentAudio(id: string, ctx: AudioContext): void {
  if (_opponents.has(id)) return;
  const panners = {
    [SoundRange.SHORT]:  createPanner(ctx, SoundRange.SHORT),
    [SoundRange.MEDIUM]: createPanner(ctx, SoundRange.MEDIUM),
    [SoundRange.LONG]:   createPanner(ctx, SoundRange.LONG),
  } as Record<SoundRange, PannerNode>;
  _opponents.set(id, { id, panners, alive: true, grindNodes: null, grindActive: false });
}

// ts-prune-ignore-next
export function getOpponentPanner(id: string, range: SoundRange): PannerNode | null {
  const opp = _opponents.get(id);
  if (!opp) return null;
  return opp.panners[range];
}

export function updateOpponentPosition(id: string, x: number, z: number): void {
  const opp = _opponents.get(id);
  if (!opp || !opp.alive) return;
  for (const key of [SoundRange.SHORT, SoundRange.MEDIUM, SoundRange.LONG] as SoundRange[]) {
    const p = opp.panners[key];
    p.positionX.value = x;
    p.positionY.value = 0;
    p.positionZ.value = z;
  }
}

export function playOpponentSound(
  id: string,
  range: SoundRange,
  play: (dest: AudioNode) => void,
): void {
  const opp = _opponents.get(id);
  if (!opp) return;
  play(opp.panners[range]);
}

export function destroyOpponentAudio(id: string): void {
  stopOpponentEngine(id);
  stopOpponentGrindLoop(id);
  const opp = _opponents.get(id);
  if (!opp) return;
  for (const key of [SoundRange.SHORT, SoundRange.MEDIUM, SoundRange.LONG] as SoundRange[]) {
    try { opp.panners[key].disconnect(); } catch { /* already disconnected */ }
  }
  _opponents.delete(id);
}

export function destroyAllOpponents(): void {
  for (const id of Array.from(_opponents.keys())) {
    destroyOpponentAudio(id);
  }
}

// ts-prune-ignore-next
export function markOpponentDead(id: string): void {
  const opp = _opponents.get(id);
  if (opp) opp.alive = false;
}

// ── Opponent Engine Synths (strategy-based) ────────────
// Each opponent gets a vehicle-appropriate engine strategy
// routed through their SHORT panner for spatial audio.

interface EngineStrategy {
  start(dest?: AudioNode): void;
  update(speedFactor: number, accelDir?: number, boosting?: boolean): void;
  stop(): void;
  isRunning(): boolean;
}

interface OpponentEngine {
  strategy: EngineStrategy;
  vehicleType: VehicleType;
  lastSpeedFactor: number;
}

const _oppEngines: Map<string, OpponentEngine> = new Map();

function createEngineStrategy(profile: VehicleAudioProfile): EngineStrategy {
  switch (profile.strategy) {
    case 'sweep': return new SweepEngine(profile);
    case 'rpm-band': return new RpmBandEngine(profile);
    case 'procedural': return new ProceduralEngine(profile.proceduralConfig!);
    default: return new ProceduralEngine(profile.proceduralConfig!);
  }
}

export function startOpponentEngine(id: string, vehicleType: VehicleType = 'hoverboard'): void {
  if (_oppEngines.has(id)) return;
  const opp = _opponents.get(id);
  if (!opp) return;
  const profile = getVehicleAudioProfile(vehicleType);
  const strategy = createEngineStrategy(profile);
  strategy.start(opp.panners[SoundRange.SHORT]);
  _oppEngines.set(id, { strategy, vehicleType, lastSpeedFactor: 0 });
}

export function updateOpponentEngine(id: string, speedFactor: number, _dt: number = 1/60): void {
  const eng = _oppEngines.get(id);
  if (!eng) return;
  const accelDir = speedFactor > eng.lastSpeedFactor ? 1
    : speedFactor < eng.lastSpeedFactor ? -1 : 0;
  const boosting = speedFactor > 1.0;
  eng.strategy.update(speedFactor, accelDir, boosting);
  eng.lastSpeedFactor = speedFactor;
}

/** Type guard for engine strategies that expose a nodes bag with a master GainNode. */
interface StrategyWithNodes {
  nodes?: { master?: GainNode };
}

function hasNodes(strategy: EngineStrategy): strategy is EngineStrategy & StrategyWithNodes {
  return 'nodes' in strategy;
}

/** Ramp engine volume to zero over duration, then stop. */
export function fadeOutOpponentEngine(id: string, duration: number = 0.3): void {
  const eng = _oppEngines.get(id);
  if (!eng) return;
  // Access the strategy's master gain for a smooth ramp
  if (hasNodes(eng.strategy)) {
    const master = (eng.strategy as StrategyWithNodes).nodes?.master;
    if (master instanceof GainNode) {
      try {
        const ctx = master.context as AudioContext;
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + duration);
      } catch {
        // Audio context may be closed or in an invalid state — skip gracefully
      }
    }
  }
  setTimeout(() => stopOpponentEngine(id), duration * 1000 + 50);
}

/** Fade out ALL running opponent engines. */
export function fadeOutAllOpponentEngines(duration: number = 0.3): void {
  for (const id of Array.from(_oppEngines.keys())) {
    fadeOutOpponentEngine(id, duration);
  }
}

export function stopOpponentEngine(id: string): void {
  const eng = _oppEngines.get(id);
  if (!eng) return;
  eng.strategy.stop();
  _oppEngines.delete(id);
}

// ── Opponent Spatial Grind Audio ─────────────────────────
// Synthesized grind loop routed through SHORT panner for 3D falloff.

/** Start a spatial grind loop for an opponent (bandpass noise + sawtooth hum). */
export function startOpponentGrindLoop(id: string): void {
  const opp = _opponents.get(id);
  if (!opp || opp.grindNodes) return;
  const c = getCtx();
  if (!c) return;
  const vol = getSfxVolume();
  const dest = opp.panners[SoundRange.SHORT];

  // Looping noise through bandpass
  const noise = c.createBufferSource();
  noise.buffer = noiseBuf(c, 2.0);
  noise.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2000;
  bp.Q.value = 1.5;
  const gain = c.createGain();
  gain.gain.value = 0.12 * vol;
  noise.connect(bp);
  bp.connect(gain);
  gain.connect(dest);
  noise.start();
  // Sawtooth hum at 120Hz
  const hum = c.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 120;
  const humGain = c.createGain();
  humGain.gain.value = 0.06 * vol;
  hum.connect(humGain);
  humGain.connect(dest);
  hum.start();
  opp.grindNodes = { noise, bp, gain, hum, humGain };
  opp.grindActive = true;
}

/** Modulate spatial grind loop parameters each frame. */
export function updateOpponentGrindLoop(
  id: string, speed: number, balance: number, dashing: boolean,
): void {
  const opp = _opponents.get(id);
  if (!opp?.grindNodes) return;
  const n = opp.grindNodes;
  const vol = getSfxVolume();
  const t = 0.05;

  // Pitch rises with speed: bandpass 1kHz–3kHz
  const targetFreq = 1000 + speed * 1000;
  n.bp.frequency.value += (targetFreq - n.bp.frequency.value) * t;

  // Volume wobble in danger zone (|balance| > 0.7)
  const danger = Math.max(0, (Math.abs(balance) - 0.7) / 0.3);
  const wobble = danger > 0 ? 1 + 0.3 * Math.sin(Date.now() * 0.015) * danger : 1;
  const targetGain = 0.12 * vol * wobble;
  n.gain.gain.value += (targetGain - n.gain.gain.value) * t;

  // Hum: detunes in danger, boosts in dash
  const baseHumFreq = 120 + speed * 40;
  const dangerDetune = danger * 20 * Math.sin(Date.now() * 0.008);
  const dashFreqBoost = dashing ? 60 : 0;
  const targetHumFreq = baseHumFreq + dangerDetune + dashFreqBoost;
  n.hum.frequency.value += (targetHumFreq - n.hum.frequency.value) * t;

  const dashVolBoost = dashing ? 1.6 : 1.0;
  const targetHumGain = 0.06 * vol * dashVolBoost * (1 + speed * 0.3);
  n.humGain.gain.value += (targetHumGain - n.humGain.gain.value) * t;
}

/** Fade out and stop spatial grind loop for an opponent. */
export function stopOpponentGrindLoop(id: string): void {
  const opp = _opponents.get(id);
  if (!opp?.grindNodes) return;
  const n = opp.grindNodes;
  opp.grindNodes = null;
  opp.grindActive = false;

  try {
    const c = getCtx();
    if (c) {
      const now = c.currentTime;
      n.gain.gain.setValueAtTime(n.gain.gain.value, now);
      n.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      n.humGain.gain.setValueAtTime(n.humGain.gain.value, now);
      n.humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      setTimeout(() => {
        try { n.noise.stop(); } catch { /* already stopped */ }
        try { n.hum.stop(); } catch { /* already stopped */ }
        try {
          n.noise.disconnect(); n.bp.disconnect(); n.gain.disconnect();
          n.hum.disconnect(); n.humGain.disconnect();
        } catch { /* already disconnected */ }
      }, 80);
    }
  } catch (e) { warnDev('spatial-grind', e); }
}

/** Schedule disconnect of one-shot sound nodes after their duration. */
function scheduleNodeDisconnect(nodes: AudioNode[], afterMs: number): void {
  setTimeout(() => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
  }, afterMs);
}

/** Play spatial grind enter (metallic clank) through opponent's SHORT panner. */
export function playOpponentGrindEnter(id: string): void {
  const opp = _opponents.get(id);
  if (!opp) return;
  const c = getCtx(); if (!c) return;
  const vol = getSfxVolume(), now = c.currentTime, dest = opp.panners[SoundRange.SHORT];
  // Noise burst through bandpass ~2kHz
  const nSrc = c.createBufferSource(); nSrc.buffer = noiseBuf(c, 0.15);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2000, now); bp.Q.value = 3;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.18 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  nSrc.connect(bp); bp.connect(ng); ng.connect(dest); nSrc.start(now);
  scheduleNodeDisconnect([nSrc, bp, ng], 200);
  // Low sine thud at 80Hz
  const thud = c.createOscillator(); thud.type = 'sine';
  thud.frequency.setValueAtTime(80, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.12);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.22 * vol, now);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  thud.connect(tg); tg.connect(dest); thud.start(now); thud.stop(now + 0.2);
  scheduleNodeDisconnect([tg], 250);
}

/** Play spatial grind bail (harsh lowpass noise + detuned drop) through SHORT panner. */
export function playOpponentGrindBail(id: string): void {
  const opp = _opponents.get(id);
  if (!opp) return;
  const c = getCtx(); if (!c) return;
  const vol = getSfxVolume(), now = c.currentTime, dest = opp.panners[SoundRange.SHORT];
  // Lowpass noise burst
  const nSrc = c.createBufferSource(); nSrc.buffer = noiseBuf(c, 0.4);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(800, now);
  lp.frequency.exponentialRampToValueAtTime(100, now + 0.35);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.2 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  nSrc.connect(lp); lp.connect(ng); ng.connect(dest); nSrc.start(now);
  scheduleNodeDisconnect([nSrc, lp, ng], 450);
  // Detuned oscillator drop 300Hz -> 80Hz
  const osc = c.createOscillator(); osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
  const og = c.createGain();
  og.gain.setValueAtTime(0.15 * vol, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(og); og.connect(dest); osc.start(now); osc.stop(now + 0.38);
  scheduleNodeDisconnect([og], 450);
}
